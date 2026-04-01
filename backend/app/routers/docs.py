"""Documentation browser API — serve markdown docs from git-cloned repos."""
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.project import Project, Task

logger = logging.getLogger(__name__)

router = APIRouter()

DOCS_ROOT = Path("/mnt/projekty-docs")

# Folders to skip when scanning doc repos for task-mapping
IGNORED_DIRS = {".git", ".obsidian", ".trash", "_resources", "assets", "attachments"}


class DocFile(BaseModel):
    name: str
    path: str
    is_dir: bool


class DocTree(BaseModel):
    repo: str
    files: list[DocFile]


class DocContent(BaseModel):
    path: str
    content: str
    filename: str


class GitSyncStatus(BaseModel):
    repo: str
    local_commit: str
    local_date: str
    remote_commit: Optional[str] = None
    remote_date: Optional[str] = None
    is_synced: bool
    behind_count: int = 0


def _safe_path(repo: str, filepath: str = "") -> Path:
    """Resolve path and ensure it doesn't escape DOCS_ROOT."""
    base = (DOCS_ROOT / repo).resolve()
    if not base.is_relative_to(DOCS_ROOT.resolve()):
        raise HTTPException(status_code=400, detail="Invalid repo")
    if filepath:
        full = (base / filepath).resolve()
        if not full.is_relative_to(base):
            raise HTTPException(status_code=400, detail="Invalid path")
        return full
    return base


@router.get("/docs/repos", response_model=list[str])
async def list_repos():
    """List all doc repositories (subdirectories of DOCS_ROOT)."""
    if not DOCS_ROOT.is_dir():
        return []
    return sorted(
        d.name for d in DOCS_ROOT.iterdir()
        if d.is_dir() and not d.name.startswith(".") and d.name not in IGNORED_DIRS
        and any(d.rglob("*.md"))
    )


@router.get("/docs/{repo}/tree", response_model=list[DocFile])
async def list_files(repo: str, subdir: str = ""):
    """List markdown files in a repo directory."""
    base = _safe_path(repo, subdir)
    if not base.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")

    items: list[DocFile] = []
    for entry in sorted(base.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
        if entry.name.startswith("."):
            continue
        rel = str(entry.relative_to(_safe_path(repo)))
        if entry.is_dir():
            # Only include dirs that contain .md files (recursively)
            if any(entry.rglob("*.md")):
                items.append(DocFile(name=entry.name, path=rel, is_dir=True))
        elif entry.suffix.lower() == ".md":
            items.append(DocFile(name=entry.name, path=rel, is_dir=False))
    return items


@router.get("/docs/{repo}/file", response_model=DocContent)
async def read_file(repo: str, path: str):
    """Read a markdown file content."""
    filepath = _safe_path(repo, path)
    if not filepath.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if filepath.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Only .md files are supported")
    content = filepath.read_text(encoding="utf-8", errors="replace")
    return DocContent(path=path, content=content, filename=filepath.name)


class DocWriteRequest(BaseModel):
    content: str


@router.put("/docs/{repo}/file")
async def write_file(repo: str, path: str, body: DocWriteRequest):
    """Write content to a markdown file. Auto-commits and pushes if git repo."""
    filepath = _safe_path(repo, path)
    if filepath.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Only .md files are supported")
    if not filepath.parent.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    filepath.write_text(body.content, encoding="utf-8")

    # Auto git commit + push if repo has .git
    repo_path = _safe_path(repo)
    git_dir = repo_path / ".git"
    if git_dir.is_dir():
        try:
            subprocess.run(
                ["git", "-C", str(repo_path), "add", str(filepath)],
                capture_output=True, timeout=10,
            )
            subprocess.run(
                ["git", "-C", str(repo_path), "commit", "-m", f"Update {path}"],
                capture_output=True, timeout=10,
            )
            subprocess.run(
                ["git", "-C", str(repo_path), "push"],
                capture_output=True, timeout=30,
            )
        except (subprocess.TimeoutExpired, Exception) as e:
            logger.warning(f"Git auto-push failed for {repo}/{path}: {e}")

    return {"status": "ok", "path": path}


@router.get("/docs/{repo}/sync", response_model=GitSyncStatus)
async def check_sync(repo: str):
    """Check if local repo is in sync with remote."""
    repo_path = _safe_path(repo)
    git_dir = repo_path / ".git"
    if not git_dir.is_dir():
        raise HTTPException(status_code=404, detail="Not a git repository")

    def git(*args: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(repo_path)] + list(args),
            capture_output=True, text=True, timeout=15,
        )
        return result.stdout.strip()

    local_commit = git("rev-parse", "HEAD")
    local_date = git("log", "-1", "--format=%ci")

    # Fetch remote to compare
    remote_commit = None
    remote_date = None
    behind_count = 0
    is_synced = True
    try:
        subprocess.run(
            ["git", "-C", str(repo_path), "fetch", "--quiet"],
            capture_output=True, timeout=15,
        )
        branch = git("rev-parse", "--abbrev-ref", "HEAD") or "main"
        remote_ref = f"origin/{branch}"
        remote_commit = git("rev-parse", remote_ref)
        if remote_commit and remote_commit != local_commit:
            remote_date = git("log", "-1", "--format=%ci", remote_ref)
            behind = git("rev-list", "--count", f"HEAD..{remote_ref}")
            behind_count = int(behind) if behind.isdigit() else 0
            is_synced = behind_count == 0
        elif remote_commit:
            remote_date = local_date
    except (subprocess.TimeoutExpired, Exception):
        pass

    return GitSyncStatus(
        repo=repo,
        local_commit=local_commit[:8],
        local_date=local_date,
        remote_commit=remote_commit[:8] if remote_commit else None,
        remote_date=remote_date,
        is_synced=is_synced,
        behind_count=behind_count,
    )


@router.post("/docs/{repo}/pull")
async def pull_repo(repo: str):
    """Pull latest changes from remote."""
    repo_path = _safe_path(repo)
    git_dir = repo_path / ".git"
    if not git_dir.is_dir():
        raise HTTPException(status_code=404, detail="Not a git repository")

    result = subprocess.run(
        ["git", "-C", str(repo_path), "pull", "--ff-only"],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise HTTPException(status_code=500, detail=f"Pull failed: {result.stderr.strip()}")

    return {"status": "ok", "output": result.stdout.strip()}


@router.post("/docs/{repo}/check-and-pull")
async def check_and_pull(repo: str):
    """Fetch remote, and if behind, auto-pull. Returns sync status + pull result."""
    repo_path = _safe_path(repo)
    git_dir = repo_path / ".git"
    if not git_dir.is_dir():
        raise HTTPException(status_code=404, detail="Not a git repository")

    def git(*args: str) -> str:
        r = subprocess.run(
            ["git", "-C", str(repo_path)] + list(args),
            capture_output=True, text=True, timeout=15,
        )
        return r.stdout.strip()

    local_commit_before = git("rev-parse", "HEAD")

    # Fetch
    try:
        subprocess.run(
            ["git", "-C", str(repo_path), "fetch", "--quiet"],
            capture_output=True, timeout=15,
        )
    except (subprocess.TimeoutExpired, Exception):
        pass

    branch = git("rev-parse", "--abbrev-ref", "HEAD") or "main"
    remote_ref = f"origin/{branch}"
    remote_commit = git("rev-parse", remote_ref)

    pulled = False
    pull_output = ""
    if remote_commit and remote_commit != local_commit_before:
        # Auto-pull
        result = subprocess.run(
            ["git", "-C", str(repo_path), "pull", "--ff-only"],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            pulled = True
            pull_output = result.stdout.strip()
        else:
            pull_output = result.stderr.strip()

    local_commit = git("rev-parse", "HEAD")
    local_date = git("log", "-1", "--format=%ci")

    return {
        "repo": repo,
        "local_commit": local_commit[:8],
        "local_date": local_date,
        "is_synced": local_commit == remote_commit,
        "pulled": pulled,
        "pull_output": pull_output,
    }


# ==================== TASK SYNC FROM DOCS ====================

def _scan_doc_folders(repo_path: Path) -> dict[str, list[str]]:
    """Scan repo for folders containing .md files. Returns {folder_name: [file_stems]}."""
    result: dict[str, list[str]] = {}
    for entry in sorted(repo_path.iterdir()):
        if not entry.is_dir() or entry.name in IGNORED_DIRS or entry.name.startswith("."):
            continue
        md_files = sorted(
            f.stem for f in entry.iterdir()
            if f.is_file() and f.suffix.lower() == ".md"
        )
        if md_files:
            result[entry.name] = md_files
    return result


def _find_matching_parent(folder_name: str, parent_tasks: list[Task]) -> Task | None:
    """Find parent task that matches folder name (case-insensitive substring)."""
    fl = folder_name.lower()
    for pt in parent_tasks:
        pl = pt.title.lower()
        if fl == pl or fl in pl or pl in fl:
            return pt
    return None


@router.post("/docs/{repo}/sync-tasks")
async def sync_tasks(repo: str, project_id: int, db: Session = Depends(get_db)):
    """
    Sync doc folders/files with project tasks, then match phases from canvas.
    - Each folder → parent task (Úkol)
    - Each .md file → subtask (Pod-úkol)
    - Canvas phases → subtask phase assignments
    Creates missing tasks. Never deletes.
    """
    repo_path = _safe_path(repo)
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    parent_tasks = (
        db.query(Task)
        .options(joinedload(Task.subtasks))
        .filter(Task.project_id == project_id, Task.parent_task_id.is_(None))
        .all()
    )

    doc_folders = _scan_doc_folders(repo_path)
    created_parents: list[str] = []
    created_subtasks: list[str] = []

    for folder_name, file_stems in doc_folders.items():
        # Find or create parent task
        parent = _find_matching_parent(folder_name, parent_tasks)
        if parent is None:
            parent = Task(
                project_id=project_id,
                title=folder_name,
                status="backlog",
                priority="medium",
                task_type="task",
                created_by="docs-sync",
            )
            db.add(parent)
            db.flush()  # get ID
            parent_tasks.append(parent)
            created_parents.append(folder_name)
            logger.info(f"Created parent task: {folder_name}")

        # Existing subtask titles (lowered) for matching
        existing_subs = list(parent.subtasks or [])
        existing_titles_lower = {s.title.lower(): s for s in existing_subs}

        for file_stem in file_stems:
            fs_lower = file_stem.lower()
            # Exact match (case-insensitive)
            if fs_lower in existing_titles_lower:
                continue
            # Substring match: file_stem is contained in or contains existing title
            matched = False
            for sub in existing_subs:
                sl = sub.title.lower()
                if fs_lower in sl or sl in fs_lower:
                    matched = True
                    break
            if matched:
                continue

            # No match → create new subtask
            new_sub = Task(
                project_id=project_id,
                parent_task_id=parent.id,
                title=file_stem,
                status="backlog",
                priority="medium",
                task_type="task",
                created_by="docs-sync",
            )
            db.add(new_sub)
            existing_subs.append(new_sub)
            existing_titles_lower[fs_lower] = new_sub
            created_subtasks.append(f"{folder_name}/{file_stem}")
            logger.info(f"Created subtask: {folder_name}/{file_stem}")

    db.commit()

    # --- Phase detection from canvas ---
    phases_info = None
    canvas_files = list(repo_path.glob("*.canvas"))
    if canvas_files:
        # Re-load parent tasks with fresh subtask IDs (after commit)
        parent_tasks = (
            db.query(Task)
            .options(joinedload(Task.subtasks))
            .filter(Task.project_id == project_id, Task.parent_task_id.is_(None))
            .all()
        )
        canvas_phases = _parse_canvas_phases(canvas_files[0])
        matched_ids: set[int] = set()
        phase_results = []
        for phase in canvas_phases:
            task_ids = []
            for doc_file in phase["doc_files"]:
                tid = _match_doc_to_task(doc_file, parent_tasks, matched_ids)
                if tid is not None:
                    task_ids.append(tid)
                    matched_ids.add(tid)
            phase_results.append({
                "number": phase["number"],
                "label": phase["label"],
                "task_ids": task_ids,
            })

        # Count subtasks not assigned to any phase
        all_subtask_ids = {
            s.id for pt in parent_tasks for s in (pt.subtasks or [])
        }
        unassigned_count = len(all_subtask_ids - matched_ids)

        phases_info = {
            "total_phases": len(phase_results),
            "phases": phase_results,
            "unassigned_subtasks": unassigned_count,
        }

    return {
        "status": "ok",
        "created_parents": created_parents,
        "created_subtasks": created_subtasks,
        "phases": phases_info,
        "summary": _build_sync_summary(created_parents, created_subtasks, phases_info),
    }


def _build_sync_summary(
    created_parents: list[str],
    created_subtasks: list[str],
    phases_info: dict | None,
) -> str:
    parts = []
    if created_parents:
        parts.append(f"Vytvořeno {len(created_parents)} nových úkolů: {', '.join(created_parents)}")
    if created_subtasks:
        parts.append(f"Vytvořeno {len(created_subtasks)} nových pod-úkolů: {', '.join(created_subtasks)}")
    if phases_info:
        n = phases_info["total_phases"]
        ua = phases_info["unassigned_subtasks"]
        if created_parents or created_subtasks:
            parts.append(f"{n} fází v canvasu")
        if ua > 0:
            parts.append(f"{ua} pod-úkolů bez přiřazené fáze")
    return "; ".join(parts) if parts else "Žádné změny"


# ==================== CANVAS PHASES ====================

def _parse_canvas_phases(canvas_path: Path) -> list[dict]:
    """Parse an Obsidian canvas file and return phase groups with their file nodes."""
    data = json.loads(canvas_path.read_text(encoding="utf-8"))
    nodes = data.get("nodes", [])

    # Collect groups (phases) sorted by x position (left-to-right = chronological order)
    groups = sorted(
        [n for n in nodes if n["type"] == "group"],
        key=lambda g: g["x"],
    )

    # Collect file nodes
    file_nodes = [n for n in nodes if n["type"] == "file"]

    # Assign file nodes to groups by checking if node position is within group bounds
    phases = []
    for idx, g in enumerate(groups, 1):
        gx, gy, gw, gh = g["x"], g["y"], g["width"], g["height"]
        files_in_phase = []
        for f in file_nodes:
            if gx <= f["x"] <= gx + gw and gy <= f["y"] <= gy + gh:
                files_in_phase.append(f["file"])
        phases.append({
            "number": idx,
            "label": g.get("label", f"Fáze {idx}"),
            "doc_files": files_in_phase,
        })

    return phases


def _fuzzy_match(text: str, candidate: str) -> bool:
    """Check if text fuzzy-matches candidate (case-insensitive, word-level)."""
    t = text.lower()
    c = candidate.lower()
    if t == c:
        return True
    if t in c or c in t:
        return True
    # Word-level: all significant words (>2 chars) from text appear in candidate
    words = [w for w in t.split() if len(w) > 2]
    if words and all(w in c for w in words):
        return True
    return False


def _match_doc_to_task(doc_file: str, parent_tasks: list, matched_ids: set) -> int | None:
    """Match a canvas doc_file path (e.g. 'Elektřina/Natáhnout kabel.md') to a subtask id."""
    parts = doc_file.replace("\\", "/").split("/")
    if len(parts) != 2:
        return None
    folder_name = parts[0]
    file_stem = parts[1].replace(".md", "")

    for parent in parent_tasks:
        if not _fuzzy_match(folder_name, parent.title):
            continue
        for sub in (parent.subtasks or []):
            if sub.id not in matched_ids and _fuzzy_match(file_stem, sub.title):
                return sub.id
    return None


@router.get("/docs/{repo}/phases")
async def get_phases(repo: str, project_id: int, db: Session = Depends(get_db)):
    """Parse canvas phases and match them to project subtasks."""
    repo_path = _safe_path(repo)

    # Find canvas file
    canvas_files = list(repo_path.glob("*.canvas"))
    if not canvas_files:
        raise HTTPException(status_code=404, detail="No .canvas file found")
    canvas_path = canvas_files[0]  # Use first canvas file

    # Parse phases from canvas
    phases = _parse_canvas_phases(canvas_path)

    # Load project with tasks
    project = (
        db.query(Project)
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    parent_tasks = (
        db.query(Task)
        .options(joinedload(Task.subtasks))
        .filter(Task.project_id == project_id, Task.parent_task_id.is_(None))
        .all()
    )

    # Match doc files to task IDs (track matched to avoid duplicates)
    matched_ids: set[int] = set()
    result_phases = []
    for phase in phases:
        task_ids = []
        for doc_file in phase["doc_files"]:
            tid = _match_doc_to_task(doc_file, parent_tasks, matched_ids)
            if tid is not None:
                task_ids.append(tid)
                matched_ids.add(tid)
        result_phases.append({
            "number": phase["number"],
            "label": phase["label"],
            "task_ids": task_ids,
        })

    return {
        "current_phase": project.current_phase or 1,
        "phases": result_phases,
    }


@router.get("/docs/check-changes")
async def check_doc_changes():
    """Return fingerprint per repo for NFS change detection."""
    if not DOCS_ROOT.is_dir():
        return {}
    result = {}
    for d in DOCS_ROOT.iterdir():
        if d.is_dir() and not d.name.startswith('.') and d.name not in IGNORED_DIRS:
            try:
                md_files = list(d.rglob("*.md"))
                if md_files:
                    total_mtime = sum(f.stat().st_mtime for f in md_files)
                    result[d.name] = {
                        "file_count": len(md_files),
                        "fingerprint": str(int(total_mtime * 1000)),
                    }
            except Exception:
                pass
    return result


# ── AI Phase Summary ──────────────────────────────────────────────────────

_STATUS_DIR = Path("/opt/webapps/projekty/data/logs")


def _status_file(repo: str) -> Path:
    return _STATUS_DIR / f"summary_status_{repo}.json"


def _write_status(repo: str, status: dict):
    _STATUS_DIR.mkdir(parents=True, exist_ok=True)
    _status_file(repo).write_text(json.dumps(status), encoding="utf-8")


def _read_status(repo: str) -> dict:
    sf = _status_file(repo)
    if sf.exists():
        try:
            return json.loads(sf.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {"status": "idle"}


async def _generate_summary_task(repo: str, project_name: str):
    """Background task: generate AI phase summary and write to docs."""
    from app.services.ai_phase_summary import generate_phase_summary
    repo_path = _safe_path(repo)
    canvas_files = list(repo_path.glob("*.canvas"))
    try:
        if not canvas_files:
            _write_status(repo, {"status": "error", "error": "Žádný .canvas soubor"})
            return
        md = await generate_phase_summary(repo_path, canvas_files[0], project_name)
        out_path = repo_path / "Souhrnná dokumentace fází.md"
        out_path.write_text(md, encoding="utf-8")
        _write_status(repo, {"status": "done", "file": str(out_path.name)})
        logger.info("Phase summary written to %s", out_path)
    except Exception as e:
        logger.error("Phase summary generation failed: %s", e)
        _write_status(repo, {"status": "error", "error": str(e)})


@router.post("/docs/{repo}/generate-phase-summary")
async def generate_phase_summary_endpoint(
    repo: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """Trigger AI generation of a phase summary document."""
    repo_path = _safe_path(repo)
    canvas_files = list(repo_path.glob("*.canvas"))
    if not canvas_files:
        raise HTTPException(status_code=404, detail="No .canvas file found in repo")

    # Find project name for this repo
    project = db.query(Project).filter(Project.docs_repo == repo).first()
    project_name = project.name if project else repo

    _write_status(repo, {"status": "generating"})
    background_tasks.add_task(_generate_summary_task, repo, project_name)
    return {"status": "started", "message": "Generování souhrnu zahájeno"}


@router.get("/docs/{repo}/phase-summary-status")
async def phase_summary_status(repo: str):
    """Check status of phase summary generation."""
    return _read_status(repo)
