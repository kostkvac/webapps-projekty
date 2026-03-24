"""Projekty API - Project Management Application."""
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine, Base
from app.models.project import (  # noqa: F401 - ensure models are registered
    Project, Task, Sprint, Label, TaskComment, TaskNote, TaskAudit,
    ProjectMember, ActivityLog,
)
from app.routers.projects import router as projects_router
from app.routers.docs import router as docs_router


logger = logging.getLogger("projekty")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables if they don't exist
    logger.info("Starting Projekty API...")
    Base.metadata.create_all(bind=engine)
    logger.info("Database tables verified/created.")
    yield
    logger.info("Shutting down Projekty API.")


app = FastAPI(
    title="Projekty API",
    description="Project Management Application",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://projekty.local",
        "http://portal.local",
        "http://finance.local",
        "http://zahrada.local",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects_router, prefix="/api/v1")
app.include_router(docs_router, prefix="/api/v1")


@app.get("/api/health")
async def health_check():
    return {"status": "ok", "app": "projekty"}
