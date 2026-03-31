"""Documentation browser API — serve markdown docs from git-cloned repos."""
import os
import subprocess
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

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
