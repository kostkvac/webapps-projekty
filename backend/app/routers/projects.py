"""Project management API endpoints."""
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, case
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.config import settings
from app.models.project import (
    Project, Task, Sprint, Label, TaskComment,
    ProjectMember, ActivityLog, TaskNote, TaskAudit,
)
from app.schemas.project import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectDetailResponse,
    TaskCreate, TaskUpdate, TaskResponse,
    SprintCreate, SprintUpdate, SprintResponse,
    LabelCreate, LabelUpdate, LabelResponse,
    TaskCommentCreate, TaskCommentResponse,
    ProjectMemberCreate, ProjectMemberResponse,
    ProjectStats, ActivityLogResponse,
    TaskNoteCreate, TaskNoteResponse, TaskAuditResponse,
)

router = APIRouter()

CURRENT_USER = settings.CURRENT_USER

AUDITED_FIELDS = [
    "status", "priority", "assigned_to", "title", "task_type",
    "story_points", "estimated_hours", "due_date", "description",
]


def _log_activity(
    db: Session,
    project_id: int,
    action: str,
    entity_type: str,
    entity_id: Optional[int] = None,
    username: Optional[str] = None,
):
    db.add(ActivityLog(
        project_id=project_id,
        username=username or CURRENT_USER,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
    ))


# ==================== PROJECTS ====================

@router.get("/projects/", response_model=List[ProjectResponse])
async def list_projects(
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = db.query(Project)
    if status:
        query = query.filter(Project.status == status)
    if priority:
        query = query.filter(Project.priority == priority)
    if search:
        query = query.filter(
            (Project.name.ilike(f"%{search}%"))
            | (Project.description.ilike(f"%{search}%"))
        )
    projects = (
        query.order_by(
            case(
                (Project.priority == "critical", 0),
                (Project.priority == "high", 1),
                (Project.priority == "medium", 2),
                (Project.priority == "low", 3),
            ),
            Project.created_at.desc(),
        )
        .options(joinedload(Project.labels), joinedload(Project.members))
        .all()
    )
    return projects


@router.get("/projects/stats", response_model=ProjectStats)
async def get_project_stats(db: Session = Depends(get_db)):
    total_projects = db.query(func.count(Project.id)).scalar() or 0
    status_counts = dict(
        db.query(Project.status, func.count(Project.id)).group_by(Project.status).all()
    )
    priority_counts = dict(
        db.query(Project.priority, func.count(Project.id)).group_by(Project.priority).all()
    )
    total_tasks = db.query(func.count(Task.id)).scalar() or 0
    task_status_counts = dict(
        db.query(Task.status, func.count(Task.id)).group_by(Task.status).all()
    )
    done_tasks = task_status_counts.get("done", 0)
    completion_rate = (done_tasks / total_tasks * 100) if total_tasks > 0 else 0.0

    return ProjectStats(
        total_projects=total_projects,
        by_status=status_counts,
        by_priority=priority_counts,
        total_tasks=total_tasks,
        tasks_by_status=task_status_counts,
        completion_rate=round(completion_rate, 1),
    )


@router.post("/projects/", response_model=ProjectResponse, status_code=201)
async def create_project(project_in: ProjectCreate, db: Session = Depends(get_db)):
    slug = Project.slugify(project_in.name)
    existing = db.query(Project).filter(Project.slug == slug).first()
    if existing:
        i = 2
        while db.query(Project).filter(Project.slug == f"{slug}-{i}").first():
            i += 1
        slug = f"{slug}-{i}"

    project = Project(
        name=project_in.name,
        slug=slug,
        description=project_in.description,
        priority=project_in.priority,
        status=project_in.status,
        location=project_in.location,
        estimated_hours=project_in.estimated_hours,
        target_date=project_in.target_date,
        created_by=CURRENT_USER,
    )
    db.add(project)
    db.flush()

    if project_in.label_ids:
        labels = db.query(Label).filter(Label.id.in_(project_in.label_ids)).all()
        project.labels = labels

    _log_activity(db, project.id, "project_created", "project", project.id)
    db.commit()
    db.refresh(project)
    return project


@router.get("/projects/{project_id}", response_model=ProjectDetailResponse)
async def get_project(project_id: int, db: Session = Depends(get_db)):
    project = (
        db.query(Project)
        .options(
            joinedload(Project.tasks).joinedload(Task.comments),
            joinedload(Project.tasks).joinedload(Task.labels),
            joinedload(Project.tasks).joinedload(Task.notes),
            joinedload(Project.tasks).joinedload(Task.audit_logs),
            joinedload(Project.members),
            joinedload(Project.labels),
        )
        .filter(Project.id == project_id)
        .first()
    )
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.patch("/projects/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: int, project_in: ProjectUpdate, db: Session = Depends(get_db)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = project_in.model_dump(exclude_unset=True)
    label_ids = update_data.pop("label_ids", None)

    for field, value in update_data.items():
        old_value = getattr(project, field, None)
        setattr(project, field, value)
        if old_value != value:
            _log_activity(db, project.id, f"project_{field}_changed", "project", project.id)

    if label_ids is not None:
        labels = db.query(Label).filter(Label.id.in_(label_ids)).all()
        project.labels = labels

    db.commit()
    db.refresh(project)
    return project


@router.delete("/projects/{project_id}", status_code=204)
async def delete_project(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    db.delete(project)
    db.commit()


# ==================== TASKS ====================

@router.get("/projects/{project_id}/tasks", response_model=List[TaskResponse])
async def list_tasks(
    project_id: int,
    status: Optional[str] = Query(None),
    priority: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    query = (
        db.query(Task)
        .options(
            joinedload(Task.comments),
            joinedload(Task.labels),
            joinedload(Task.notes),
            joinedload(Task.audit_logs),
        )
        .filter(Task.project_id == project_id)
    )
    if status:
        query = query.filter(Task.status == status)
    if priority:
        query = query.filter(Task.priority == priority)
    return query.order_by(Task.sort_order, Task.created_at.desc()).all()


@router.post("/projects/{project_id}/tasks", response_model=TaskResponse, status_code=201)
async def create_task(
    project_id: int, task_in: TaskCreate, db: Session = Depends(get_db)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    task = Task(
        project_id=project_id,
        sprint_id=task_in.sprint_id,
        title=task_in.title,
        description=task_in.description,
        task_type=task_in.task_type,
        status=task_in.status,
        priority=task_in.priority,
        story_points=task_in.story_points,
        estimated_hours=task_in.estimated_hours,
        assigned_to=task_in.assigned_to,
        sort_order=task_in.sort_order,
        due_date=task_in.due_date,
        created_by=CURRENT_USER,
    )
    if task_in.label_ids:
        labels = db.query(Label).filter(Label.id.in_(task_in.label_ids)).all()
        task.labels = labels
    db.add(task)
    db.flush()
    _log_activity(db, project_id, "task_created", "task", task.id)
    db.commit()
    db.refresh(task)
    return task


@router.get("/tasks/{task_id}", response_model=TaskResponse)
async def get_task(task_id: int, db: Session = Depends(get_db)):
    task = (
        db.query(Task)
        .options(
            joinedload(Task.comments),
            joinedload(Task.labels),
            joinedload(Task.notes),
            joinedload(Task.audit_logs),
        )
        .filter(Task.id == task_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return task


@router.patch("/tasks/{task_id}", response_model=TaskResponse)
async def update_task(task_id: int, task_in: TaskUpdate, db: Session = Depends(get_db)):
    task = (
        db.query(Task)
        .options(
            joinedload(Task.comments),
            joinedload(Task.labels),
            joinedload(Task.notes),
            joinedload(Task.audit_logs),
        )
        .filter(Task.id == task_id)
        .first()
    )
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    update_data = task_in.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        old_val = getattr(task, field, None)
        str_old = str(old_val) if old_val is not None else None
        str_new = str(value) if value is not None else None
        if str_old != str_new and field in AUDITED_FIELDS:
            db.add(TaskAudit(
                task_id=task_id,
                field=field,
                old_value=str_old,
                new_value=str_new,
                changed_by=CURRENT_USER,
            ))
            if field == "status":
                _log_activity(db, task.project_id, "task_status_changed", "task", task.id)
        setattr(task, field, value)

    db.commit()
    db.refresh(task)
    return task


@router.delete("/tasks/{task_id}", status_code=204)
async def delete_task(task_id: int, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    _log_activity(db, task.project_id, "task_deleted", "task", task.id)
    db.delete(task)
    db.commit()


# ==================== COMMENTS ====================

@router.post("/tasks/{task_id}/comments", response_model=TaskCommentResponse, status_code=201)
async def add_comment(task_id: int, comment_in: TaskCommentCreate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    comment = TaskComment(
        task_id=task_id,
        author=CURRENT_USER,
        content=comment_in.content,
    )
    db.add(comment)
    db.flush()
    _log_activity(db, task.project_id, "comment_added", "comment", comment.id)
    db.commit()
    db.refresh(comment)
    return comment


# ==================== NOTES ====================

@router.post("/tasks/{task_id}/notes", response_model=TaskNoteResponse, status_code=201)
async def add_note(task_id: int, note_in: TaskNoteCreate, db: Session = Depends(get_db)):
    task = db.query(Task).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if note_in.note_type not in ("bug", "note", "idea"):
        raise HTTPException(status_code=400, detail="note_type must be bug, note, or idea")
    note = TaskNote(
        task_id=task_id,
        note_type=note_in.note_type,
        content=note_in.content,
        author=CURRENT_USER,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


@router.patch("/notes/{note_id}/resolve", response_model=TaskNoteResponse)
async def toggle_note_resolved(note_id: int, db: Session = Depends(get_db)):
    note = db.query(TaskNote).filter(TaskNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    note.resolved = not note.resolved
    db.commit()
    db.refresh(note)
    return note


@router.post("/notes/{note_id}/promote", response_model=TaskNoteResponse)
async def promote_idea_to_task(note_id: int, db: Session = Depends(get_db)):
    note = db.query(TaskNote).filter(TaskNote.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    if note.note_type != "idea":
        raise HTTPException(status_code=400, detail="Only idea notes can be promoted")
    if note.promoted_task_id:
        raise HTTPException(status_code=400, detail="Idea already promoted")

    parent_task = db.query(Task).filter(Task.id == note.task_id).first()
    if not parent_task:
        raise HTTPException(status_code=404, detail="Parent task not found")

    new_task = Task(
        project_id=parent_task.project_id,
        title=note.content[:500],
        description=f"Promoted from idea on task #{parent_task.id}: {parent_task.title}",
        status="backlog",
        priority="medium",
        created_by=CURRENT_USER,
    )
    db.add(new_task)
    db.flush()
    note.promoted_task_id = new_task.id
    _log_activity(db, parent_task.project_id, "idea_promoted", "task", new_task.id)
    db.commit()
    db.refresh(note)
    return note


# ==================== AUDIT ====================

@router.get("/tasks/{task_id}/audit", response_model=List[TaskAuditResponse])
async def get_task_audit(task_id: int, db: Session = Depends(get_db)):
    return (
        db.query(TaskAudit)
        .filter(TaskAudit.task_id == task_id)
        .order_by(TaskAudit.changed_at.desc())
        .all()
    )


# ==================== LABELS ====================

@router.get("/labels/", response_model=List[LabelResponse])
async def list_labels(db: Session = Depends(get_db)):
    return db.query(Label).order_by(Label.name).all()


@router.post("/labels/", response_model=LabelResponse, status_code=201)
async def create_label(label_in: LabelCreate, db: Session = Depends(get_db)):
    existing = db.query(Label).filter(Label.name == label_in.name).first()
    if existing:
        raise HTTPException(status_code=409, detail="Label already exists")
    label = Label(name=label_in.name, color=label_in.color, description=label_in.description)
    db.add(label)
    db.commit()
    db.refresh(label)
    return label


@router.patch("/labels/{label_id}", response_model=LabelResponse)
async def update_label(label_id: int, label_in: LabelUpdate, db: Session = Depends(get_db)):
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label_in.name is not None:
        conflict = db.query(Label).filter(Label.name == label_in.name, Label.id != label_id).first()
        if conflict:
            raise HTTPException(status_code=409, detail="Label name already exists")
        label.name = label_in.name
    if label_in.color is not None:
        label.color = label_in.color
    if label_in.description is not None:
        label.description = label_in.description
    db.commit()
    db.refresh(label)
    return label


@router.delete("/labels/{label_id}", status_code=204)
async def delete_label(label_id: int, db: Session = Depends(get_db)):
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    db.delete(label)
    db.commit()


@router.post("/tasks/{task_id}/labels/{label_id}", response_model=TaskResponse)
async def add_label_to_task(
    task_id: int, label_id: int, db: Session = Depends(get_db)
):
    task = db.query(Task).options(joinedload(Task.labels)).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label not in task.labels:
        task.labels.append(label)
        db.commit()
        db.refresh(task)
    return task


@router.delete("/tasks/{task_id}/labels/{label_id}", response_model=TaskResponse)
async def remove_label_from_task(
    task_id: int, label_id: int, db: Session = Depends(get_db)
):
    task = db.query(Task).options(joinedload(Task.labels)).filter(Task.id == task_id).first()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    label = db.query(Label).filter(Label.id == label_id).first()
    if label and label in task.labels:
        task.labels.remove(label)
        db.commit()
        db.refresh(task)
    return task


@router.post("/projects/{project_id}/labels/{label_id}", response_model=ProjectResponse)
async def add_label_to_project(
    project_id: int, label_id: int, db: Session = Depends(get_db)
):
    project = db.query(Project).options(joinedload(Project.labels)).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    label = db.query(Label).filter(Label.id == label_id).first()
    if not label:
        raise HTTPException(status_code=404, detail="Label not found")
    if label not in project.labels:
        project.labels.append(label)
        db.commit()
        db.refresh(project)
    return project


@router.delete("/projects/{project_id}/labels/{label_id}", response_model=ProjectResponse)
async def remove_label_from_project(
    project_id: int, label_id: int, db: Session = Depends(get_db)
):
    project = db.query(Project).options(joinedload(Project.labels)).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    label = db.query(Label).filter(Label.id == label_id).first()
    if label and label in project.labels:
        project.labels.remove(label)
        db.commit()
        db.refresh(project)
    return project


# ==================== MEMBERS ====================

@router.get("/projects/{project_id}/members", response_model=List[ProjectMemberResponse])
async def get_project_members(project_id: int, db: Session = Depends(get_db)):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    return project.members


@router.post("/projects/{project_id}/members", response_model=ProjectMemberResponse, status_code=201)
async def add_project_member(
    project_id: int, member_in: ProjectMemberCreate, db: Session = Depends(get_db)
):
    project = db.query(Project).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")
    existing = db.query(ProjectMember).filter(
        ProjectMember.project_id == project_id,
        ProjectMember.username == member_in.username,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="User already assigned to this project")
    member = ProjectMember(
        project_id=project_id, username=member_in.username, role=member_in.role
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


@router.delete("/projects/{project_id}/members/{member_id}", status_code=204)
async def remove_project_member(
    project_id: int, member_id: int, db: Session = Depends(get_db)
):
    member = db.query(ProjectMember).filter(
        ProjectMember.id == member_id, ProjectMember.project_id == project_id
    ).first()
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    db.delete(member)
    db.commit()


# ==================== ACTIVITY ====================

@router.get("/projects/{project_id}/activity", response_model=List[ActivityLogResponse])
async def get_project_activity(
    project_id: int,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
):
    return (
        db.query(ActivityLog)
        .filter(ActivityLog.project_id == project_id)
        .order_by(ActivityLog.created_at.desc())
        .limit(limit)
        .all()
    )
