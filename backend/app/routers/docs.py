"""Documentation browser API — serve markdown docs from git-cloned repos."""
import json
import os
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.project import Project, Task

router = APIRouter()

DOCS_ROOT = Path("/opt/webapps/projekty/docs")


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
    """List all doc repositories (subdirectories of docs/)."""
    if not DOCS_ROOT.is_dir():
        return []
    return sorted(
        d.name for d in DOCS_ROOT.iterdir()
        if d.is_dir() and (d / ".git").is_dir()
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
    """Write content to a markdown file."""
    filepath = _safe_path(repo, path)
    if filepath.suffix.lower() != ".md":
        raise HTTPException(status_code=400, detail="Only .md files are supported")
    if not filepath.parent.is_dir():
        raise HTTPException(status_code=404, detail="Directory not found")
    filepath.write_text(body.content, encoding="utf-8")
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
        # Exact/strong fuzzy match first
        for sub in (parent.subtasks or []):
            if sub.id not in matched_ids and _fuzzy_match(file_stem, sub.title):
                return sub.id
        # Fallback: match if any significant word (>3 chars) from file stem appears in subtask title
        stem_words = [w for w in file_stem.lower().split() if len(w) > 3]
        for sub in (parent.subtasks or []):
            if sub.id not in matched_ids:
                sub_lower = sub.title.lower()
                if any(w in sub_lower for w in stem_words):
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
