"""
Project management models for projekty database.
"""
import re
from sqlalchemy import (
    Column, Integer, String, Text, Date, DateTime, Boolean, Float,
    ForeignKey, Table, UniqueConstraint, select
)
from sqlalchemy.orm import relationship, column_property
from sqlalchemy.sql import func

from app.database import Base


# Many-to-many: project <-> label
project_labels = Table(
    "project_labels",
    Base.metadata,
    Column("project_id", Integer, ForeignKey("projects.id", ondelete="CASCADE"), primary_key=True),
    Column("label_id", Integer, ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True),
)

# Many-to-many: task <-> label
task_labels = Table(
    "task_labels",
    Base.metadata,
    Column("task_id", Integer, ForeignKey("tasks.id", ondelete="CASCADE"), primary_key=True),
    Column("label_id", Integer, ForeignKey("labels.id", ondelete="CASCADE"), primary_key=True),
)


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(200), nullable=False)
    slug = Column(String(200), nullable=False, unique=True)
    description = Column(Text)
    docs_repo = Column(String(200))
    status = Column(String(50), default="backlog")
    priority = Column(String(50), default="medium")
    location = Column(String(500))
    estimated_hours = Column(Float)
    actual_hours = Column(Float, default=0)
    target_date = Column(Date)
    current_phase = Column(Integer, default=1)
    created_by = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    tasks = relationship("Task", back_populates="project", cascade="all, delete-orphan")
    sprints = relationship("Sprint", back_populates="project", cascade="all, delete-orphan")
    members = relationship("ProjectMember", back_populates="project", cascade="all, delete-orphan")
    activities = relationship("ActivityLog", back_populates="project", cascade="all, delete-orphan")
    labels = relationship("Label", secondary=project_labels, back_populates="projects")

    @staticmethod
    def slugify(text: str) -> str:
        text = text.lower().strip()
        text = re.sub(r"[^\w\s-]", "", text)
        text = re.sub(r"[\s_]+", "-", text)
        text = re.sub(r"-+", "-", text)
        return text.strip("-")


class Sprint(Base):
    __tablename__ = "sprints"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(200), nullable=False)
    goal = Column(Text)
    status = Column(String(50), default="planning")
    start_date = Column(Date)
    end_date = Column(Date)
    created_at = Column(DateTime, server_default=func.now())

    project = relationship("Project", back_populates="sprints")
    tasks = relationship("Task", back_populates="sprint")


class Task(Base):
    __tablename__ = "tasks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    sprint_id = Column(Integer, ForeignKey("sprints.id", ondelete="SET NULL"))
    parent_task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"))
    title = Column(String(500), nullable=False)
    description = Column(Text)
    task_type = Column(String(50), default="task")
    status = Column(String(50), default="backlog")
    priority = Column(String(50), default="medium")
    assigned_to = Column(String(100))
    story_points = Column(Integer)
    estimated_hours = Column(Float)
    actual_hours = Column(Float, default=0)
    due_date = Column(Date)
    sort_order = Column(Integer, default=0)
    created_by = Column(String(100))
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())

    project = relationship("Project", back_populates="tasks")
    sprint = relationship("Sprint", back_populates="tasks")
    parent = relationship("Task", remote_side=[id], back_populates="subtasks")
    subtasks = relationship("Task", back_populates="parent", cascade="all, delete-orphan")
    comments = relationship("TaskComment", back_populates="task", cascade="all, delete-orphan")
    notes = relationship("TaskNote", back_populates="task", cascade="all, delete-orphan", foreign_keys="[TaskNote.task_id]")
    audit_logs = relationship("TaskAudit", back_populates="task", cascade="all, delete-orphan", foreign_keys="[TaskAudit.task_id]")
    labels = relationship("Label", secondary=task_labels, back_populates="tasks")


class Label(Base):
    __tablename__ = "labels"

    id = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String(100), nullable=False, unique=True)
    color = Column(String(20), default="#007638")
    description = Column(String(500))
    created_at = Column(DateTime, server_default=func.now())

    tasks = relationship("Task", secondary=task_labels, back_populates="labels")
    projects = relationship("Project", secondary=project_labels, back_populates="labels")


class TaskComment(Base):
    __tablename__ = "task_comments"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    author = Column(String(100), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("Task", back_populates="comments")


class TaskNote(Base):
    __tablename__ = "task_notes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    note_type = Column(String(20), nullable=False, default="note")
    content = Column(Text, nullable=False)
    author = Column(String(100), nullable=False)
    resolved = Column(Boolean, default=False)
    promoted_task_id = Column(Integer, ForeignKey("tasks.id", ondelete="SET NULL"))
    created_at = Column(DateTime, server_default=func.now())

    task = relationship("Task", back_populates="notes", foreign_keys=[task_id])


class TaskAudit(Base):
    __tablename__ = "task_audit"

    id = Column(Integer, primary_key=True, autoincrement=True)
    task_id = Column(Integer, ForeignKey("tasks.id", ondelete="CASCADE"), nullable=False)
    changed_by = Column(String(100), nullable=False)
    field = Column(String(100), nullable=False)
    old_value = Column(String(500))
    new_value = Column(String(500))
    changed_at = Column(DateTime, server_default=func.now())

    task = relationship("Task", back_populates="audit_logs", foreign_keys=[task_id])


class ProjectMember(Base):
    __tablename__ = "project_members"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    username = Column(String(100), nullable=False)
    role = Column(String(50), default="developer")
    added_at = Column(DateTime, server_default=func.now())

    project = relationship("Project", back_populates="members")

    __table_args__ = (
        UniqueConstraint("project_id", "username", name="uq_project_member"),
    )


class ActivityLog(Base):
    __tablename__ = "activity_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    username = Column(String(100), nullable=False)
    action = Column(String(200), nullable=False)
    entity_type = Column(String(50))
    entity_id = Column(Integer)
    created_at = Column(DateTime, server_default=func.now())

    project = relationship("Project", back_populates="activities")


# Computed column: task count per project (top-level only = úkoly)
Project.task_count = column_property(
    select(func.count(Task.id))
    .where(Task.project_id == Project.id)
    .where(Task.parent_task_id.is_(None))
    .correlate(Project)
    .scalar_subquery()
)

# Computed column: progress percent per project (top-level tasks only)
Project.progress_percent = column_property(
    select(
        func.coalesce(
            func.round(
                func.sum(func.IF(Task.status == "done", 1, 0)) * 100.0
                / func.nullif(func.count(Task.id), 0)
            ),
            0,
        )
    )
    .where(Task.project_id == Project.id)
    .where(Task.parent_task_id.is_(None))
    .correlate(Project)
    .scalar_subquery()
)
