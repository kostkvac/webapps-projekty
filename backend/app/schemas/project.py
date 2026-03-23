"""Pydantic schemas for project management."""
from datetime import date, datetime
from typing import List, Optional
from pydantic import BaseModel, Field


# ---- Label ----
class LabelCreate(BaseModel):
    name: str = Field(..., max_length=100)
    color: str = Field(default="#007638", max_length=20)
    description: Optional[str] = None

class LabelUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None

class LabelResponse(BaseModel):
    id: int
    name: str
    color: str
    description: Optional[str] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ---- Task Comment ----
class TaskCommentCreate(BaseModel):
    content: str = Field(..., min_length=1)

class TaskCommentResponse(BaseModel):
    id: int
    task_id: int
    author: str
    content: str
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ---- Task Note ----
class TaskNoteCreate(BaseModel):
    note_type: str = Field(default="note")
    content: str = Field(..., min_length=1)

class TaskNoteResponse(BaseModel):
    id: int
    task_id: int
    note_type: str
    content: str
    author: str
    resolved: bool = False
    promoted_task_id: Optional[int] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ---- Task Audit ----
class TaskAuditResponse(BaseModel):
    id: int
    task_id: int
    field: str
    old_value: Optional[str] = None
    new_value: Optional[str] = None
    changed_by: str
    changed_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ---- Task ----
class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=500)
    description: Optional[str] = None
    task_type: str = Field(default="task")
    status: str = Field(default="backlog")
    priority: str = Field(default="medium")
    story_points: Optional[int] = None
    estimated_hours: Optional[float] = None
    assigned_to: Optional[str] = None
    sort_order: int = 0
    due_date: Optional[date] = None
    sprint_id: Optional[int] = None

class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    task_type: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    story_points: Optional[int] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    assigned_to: Optional[str] = None
    sort_order: Optional[int] = None
    due_date: Optional[date] = None
    sprint_id: Optional[int] = None

class TaskResponse(BaseModel):
    id: int
    project_id: int
    sprint_id: Optional[int] = None
    title: str
    description: Optional[str] = None
    task_type: str
    status: str
    priority: str
    story_points: Optional[int] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    assigned_to: Optional[str] = None
    sort_order: int = 0
    due_date: Optional[date] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    comments: List[TaskCommentResponse] = []
    labels: List[LabelResponse] = []
    notes: List[TaskNoteResponse] = []
    audit_logs: List[TaskAuditResponse] = []
    model_config = {"from_attributes": True}


# ---- Sprint ----
class SprintCreate(BaseModel):
    name: str = Field(..., max_length=200)
    goal: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None

class SprintUpdate(BaseModel):
    name: Optional[str] = None
    goal: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[date] = None
    end_date: Optional[date] = None

class SprintResponse(BaseModel):
    id: int
    project_id: int
    name: str
    goal: Optional[str] = None
    status: str
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ---- Project Member ----
class ProjectMemberCreate(BaseModel):
    username: str
    role: str = Field(default="developer")

class ProjectMemberResponse(BaseModel):
    id: int
    project_id: int
    username: str
    role: str
    added_at: Optional[datetime] = None
    model_config = {"from_attributes": True}


# ---- Project ----
class ProjectCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    priority: str = Field(default="medium")
    status: str = Field(default="backlog")
    location: Optional[str] = None
    estimated_hours: Optional[float] = None
    target_date: Optional[date] = None
    label_ids: List[int] = []

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    location: Optional[str] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    target_date: Optional[date] = None
    label_ids: Optional[List[int]] = None

class ProjectResponse(BaseModel):
    id: int
    name: str
    slug: str
    description: Optional[str] = None
    status: str
    priority: str
    location: Optional[str] = None
    estimated_hours: Optional[float] = None
    actual_hours: Optional[float] = None
    target_date: Optional[date] = None
    created_by: Optional[str] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    task_count: int = 0
    progress_percent: int = 0
    labels: List[LabelResponse] = []
    members: List[ProjectMemberResponse] = []
    model_config = {"from_attributes": True}

class ProjectDetailResponse(ProjectResponse):
    tasks: List[TaskResponse] = []
    model_config = {"from_attributes": True}


# ---- Statistics ----
class ProjectStats(BaseModel):
    total_projects: int = 0
    by_status: dict = {}
    by_priority: dict = {}
    total_tasks: int = 0
    tasks_by_status: dict = {}
    completion_rate: float = 0.0


# ---- Activity Log ----
class ActivityLogResponse(BaseModel):
    id: int
    project_id: int
    username: str
    action: str
    entity_type: Optional[str] = None
    entity_id: Optional[int] = None
    created_at: Optional[datetime] = None
    model_config = {"from_attributes": True}
