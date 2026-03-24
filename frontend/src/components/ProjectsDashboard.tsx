import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactElement } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, Button, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, LinearProgress,
  Paper, Stack, CircularProgress, Snackbar, Alert, Badge,
  Checkbox, OutlinedInput, ListItemText,
  ToggleButton, ToggleButtonGroup,
  Divider, Switch, FormControlLabel, Tooltip,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Add, Edit, Delete, FolderOpen, Assignment,
  Schedule, Science,
  ViewModule, ViewList, ViewStream,
  OpenInFull, CloseFullscreen,
  FilterList, PriorityHigh, Flag,
  PlayArrow, Pause, Done, Block,
  Close,
  BugReport, Lightbulb, NoteAlt, CheckCircle,
  Rocket, History, StickyNote2, Comment,
  ArrowForward,
} from '@mui/icons-material';
import projectsApi from '../api/projects';
import type { Project, Task, ProjectDetail, Label, TaskNote, TaskAudit } from '../api/projects';

const COLORS = {
  darkForest: '#00472e',
  emerald: '#007638',
  mediumGreen: '#01935e',
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; icon: ReactElement }> = {
  backlog:     { label: 'Idea',        color: '#9c27b0', bg: '#f3e5f5', icon: <Schedule fontSize="small" /> },
  planning:    { label: 'Planning',    color: '#1565c0', bg: '#e3f2fd', icon: <Assignment fontSize="small" /> },
  in_progress: { label: 'In Progress', color: COLORS.emerald, bg: '#e8f5e9', icon: <PlayArrow fontSize="small" /> },
  testing:     { label: 'Testing',     color: '#e65100', bg: '#fff3e0', icon: <Science fontSize="small" /> },
  review:      { label: 'Review',      color: '#f57c00', bg: '#fff8e1', icon: <Pause fontSize="small" /> },
  done:        { label: 'Done',        color: '#2e7d32', bg: '#c8e6c9', icon: <Done fontSize="small" /> },
  archived:    { label: 'Blocked',     color: '#c62828', bg: '#ffebee', icon: <Block fontSize="small" /> },
};

const TASK_STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  backlog:     { label: 'Idea',        color: '#9c27b0', bg: '#f3e5f5' },
  todo:        { label: 'Planning',    color: '#1565c0', bg: '#e3f2fd' },
  in_progress: { label: 'In Progress', color: COLORS.emerald, bg: '#e8f5e9' },
  testing:     { label: 'Testing',     color: '#e65100', bg: '#fff3e0' },
  review:      { label: 'Review',      color: '#f57c00', bg: '#fff8e1' },
  done:        { label: 'Done',        color: '#2e7d32', bg: '#c8e6c9' },
  blocked:     { label: 'Blocked',     color: '#c62828', bg: '#ffebee' },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; icon?: ReactElement }> = {
  low:      { label: 'Low',      color: '#66bb6a' },
  medium:   { label: 'Medium',   color: '#ffa726' },
  high:     { label: 'High',     color: '#ef5350', icon: <PriorityHigh fontSize="small" /> },
  critical: { label: 'Critical', color: '#c62828', icon: <Flag fontSize="small" /> },
};

const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'testing', 'review', 'done', 'blocked'];
const PROJECT_STATUSES = ['backlog', 'planning', 'in_progress', 'testing', 'review', 'done', 'archived'];

export default function ProjectsDashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success'
  });

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterPriority, setFilterPriority] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterLabel, setFilterLabel] = useState<number[]>([]);

  // View modes
  const [projectViewMode, setProjectViewMode] = useState<'list' | 'kanban' | 'swimlane' | 'detailed'>('list');
  const [taskViewMode, setTaskViewMode] = useState<'list' | 'kanban' | 'swimlane'>('list');
  const [tileDetailOpen, setTileDetailOpen] = useState(false);
  const [tileDetailExpanded, setTileDetailExpanded] = useState(false);

  // Drag state
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [dragOverColumn, setDragOverColumn] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<number | null>(null);
  const [dragOverProjectColumn, setDragOverProjectColumn] = useState<string | null>(null);

  // Dialogs
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Partial<Project> & { label_ids?: number[] } | null>(null);
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'project' | 'task'; id: number } | null>(null);

  // Notes/Comments/Audit
  const [commentText, setCommentText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<'bug' | 'note' | 'idea'>('note');
  const [showAudit, setShowAudit] = useState(false);

  // Labels dialog
  const [labelsDialogOpen, setLabelsDialogOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<{ name: string; color: string; description: string }>({ name: '', color: '#4caf50', description: '' });

  // Track previous task statuses for checkbox undo
  const [taskPrevStatus, setTaskPrevStatus] = useState<Record<number, string>>({});

  // ---- Filtering ----
  const filteredProjects = useMemo(() => projects.filter(p => {
    if (filterStatus && p.status !== filterStatus) return false;
    if (filterPriority && p.priority !== filterPriority) return false;
    if (filterLabel.length > 0 && !p.labels?.some(l => filterLabel.includes(l.id))) return false;
    if (searchQuery && !p.name.toLowerCase().includes(searchQuery.toLowerCase()) && !(p.description ?? '').toLowerCase().includes(searchQuery.toLowerCase())) return false;
    return true;
  }), [projects, filterStatus, filterPriority, filterLabel, searchQuery]);

  const availableStatuses = useMemo(() => new Set(projects.map(p => p.status)), [projects]);
  const availablePriorities = useMemo(() => new Set(projects.map(p => p.priority)), [projects]);
  const availableLabels = useMemo(() => {
    const counts = new Map<number, { label: Label; count: number }>();
    projects.forEach(p => p.labels?.forEach(l => {
      const entry = counts.get(l.id);
      if (entry) entry.count++;
      else counts.set(l.id, { label: l, count: 1 });
    }));
    return counts;
  }, [projects]);

  // ---- Data Loading ----
  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const [projectList, labelList] = await Promise.all([
        projectsApi.list(),
        projectsApi.listLabels(),
      ]);
      setProjects(projectList);
      setAllLabels(labelList);
    } catch {
      setSnackbar({ open: true, message: 'Failed to load projects', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const loadProjectDetail = async (id: number, openModal = false) => {
    try {
      const detail = await projectsApi.get(id);
      setSelectedProject(detail);
      if (openModal) setTileDetailOpen(true);
    } catch {
      setSnackbar({ open: true, message: 'Failed to load project details', severity: 'error' });
    }
  };

  // ---- Project CRUD ----
  const handleSaveProject = async () => {
    if (!editingProject?.name) return;
    try {
      if (editingProject.id) {
        await projectsApi.update(editingProject.id, editingProject);
        setSnackbar({ open: true, message: 'Project updated', severity: 'success' });
      } else {
        await projectsApi.create(editingProject);
        setSnackbar({ open: true, message: 'Project created', severity: 'success' });
      }
      setProjectDialogOpen(false);
      setEditingProject(null);
      loadProjects();
      if (editingProject.id && selectedProject?.id === editingProject.id) loadProjectDetail(editingProject.id);
    } catch {
      setSnackbar({ open: true, message: 'Failed to save project', severity: 'error' });
    }
  };

  // ---- Task CRUD ----
  const handleSaveTask = async () => {
    if (!editingTask?.title || !selectedProject) return;
    try {
      if (editingTask.id) {
        await projectsApi.updateTask(editingTask.id, editingTask);
        setSnackbar({ open: true, message: 'Task updated', severity: 'success' });
      } else {
        await projectsApi.createTask(selectedProject.id, editingTask);
        setSnackbar({ open: true, message: 'Task created', severity: 'success' });
      }
      setTaskDialogOpen(false);
      setEditingTask(null);
      loadProjectDetail(selectedProject.id);
      loadProjects();
    } catch {
      setSnackbar({ open: true, message: 'Failed to save task', severity: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'project') {
        await projectsApi.delete(deleteTarget.id);
        if (selectedProject?.id === deleteTarget.id) setSelectedProject(null);
        setSnackbar({ open: true, message: 'Project deleted', severity: 'success' });
      } else {
        await projectsApi.deleteTask(deleteTarget.id);
        setSnackbar({ open: true, message: 'Task deleted', severity: 'success' });
      }
      setDeleteConfirmOpen(false);
      setDeleteTarget(null);
      loadProjects();
      if (selectedProject) loadProjectDetail(selectedProject.id);
    } catch {
      setSnackbar({ open: true, message: 'Delete failed', severity: 'error' });
    }
  };

  const handleQuickStatusChange = async (taskId: number, newStatus: string) => {
    try {
      await projectsApi.updateTask(taskId, { status: newStatus } as any);
      if (selectedProject) loadProjectDetail(selectedProject.id);
      loadProjects();
    } catch {
      setSnackbar({ open: true, message: 'Status update failed', severity: 'error' });
    }
  };

  const handleQuickProjectStatusChange = async (projectId: number, newStatus: string) => {
    try {
      await projectsApi.update(projectId, { status: newStatus } as any);
      loadProjects();
      if (selectedProject?.id === projectId) loadProjectDetail(projectId);
    } catch {
      setSnackbar({ open: true, message: 'Status update failed', severity: 'error' });
    }
  };

  // ---- Comments ----
  const handleAddComment = async (taskId: number) => {
    if (!commentText.trim()) return;
    try {
      await projectsApi.addComment(taskId, commentText);
      setCommentText('');
      if (selectedProject) loadProjectDetail(selectedProject.id);
      if (editingTask?.id === taskId) {
        const t = await projectsApi.getTask(taskId);
        setEditingTask(t);
      }
    } catch {
      setSnackbar({ open: true, message: 'Failed to add comment', severity: 'error' });
    }
  };

  // ---- Notes ----
  const handleAddNote = async (taskId: number) => {
    if (!noteText.trim()) return;
    try {
      const newNote = await projectsApi.addNote(taskId, noteType, noteText);
      setNoteText('');
      setNoteType('note');
      setEditingTask(prev => prev ? { ...prev, notes: [...(prev.notes || []), newNote] } : prev);
      if (selectedProject) loadProjectDetail(selectedProject.id);
    } catch {
      setSnackbar({ open: true, message: 'Failed to add note', severity: 'error' });
    }
  };

  const handleToggleNoteResolved = async (noteId: number) => {
    try {
      const updated = await projectsApi.toggleNoteResolved(noteId);
      setEditingTask(prev => prev ? {
        ...prev,
        notes: (prev.notes || []).map((n: TaskNote) => n.id === noteId ? updated : n),
      } : prev);
      if (selectedProject) loadProjectDetail(selectedProject.id);
    } catch {
      setSnackbar({ open: true, message: 'Failed to update note', severity: 'error' });
    }
  };

  const handlePromoteIdea = async (noteId: number) => {
    try {
      const updated = await projectsApi.promoteIdea(noteId);
      setEditingTask(prev => prev ? {
        ...prev,
        notes: (prev.notes || []).map((n: TaskNote) => n.id === noteId ? updated : n),
      } : prev);
      if (selectedProject) loadProjectDetail(selectedProject.id);
      setSnackbar({ open: true, message: 'Idea promoted to task!', severity: 'success' });
    } catch {
      setSnackbar({ open: true, message: 'Failed to promote idea', severity: 'error' });
    }
  };

  // ---- Labels ----
  const handleSaveLabel = async () => {
    if (!editingLabel.name) return;
    try {
      await projectsApi.createLabel(editingLabel);
      setEditingLabel({ name: '', color: '#4caf50', description: '' });
      loadProjects();
    } catch {
      setSnackbar({ open: true, message: 'Failed to save label', severity: 'error' });
    }
  };

  const handleDeleteLabel = async (id: number) => {
    try {
      await projectsApi.deleteLabel(id);
      loadProjects();
    } catch {
      setSnackbar({ open: true, message: 'Failed to delete label', severity: 'error' });
    }
  };

  // ---- Render Helpers ----
  const statusChip = (status: string, config: Record<string, any>) => {
    const c = config[status] || { label: status, color: '#666', bg: '#eee' };
    return (
      <Chip
        label={c.label}
        size="small"
        sx={{ bgcolor: c.bg, color: c.color, fontWeight: 600, fontSize: '0.75rem' }}
      />
    );
  };

  const priorityChip = (priority: string) => {
    const c = PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.medium;
    return <Chip label={c.label} size="small" icon={c.icon || undefined} sx={{ bgcolor: c.color + '22', color: c.color, fontWeight: 600, fontSize: '0.75rem' }} />;
  };

  // ========== PROJECT CARD ==========
  const renderProjectCard = (project: Project, opts?: { draggable?: boolean }) => {
    const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.backlog;
    const isDragging = draggedProjectId === project.id;
    return (
      <Card
        key={project.id}
        draggable={!!opts?.draggable}
        onDragStart={opts?.draggable ? (e) => { setDraggedProjectId(project.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
        onDragEnd={opts?.draggable ? () => { setDraggedProjectId(null); setDragOverProjectColumn(null); } : undefined}
        sx={{
          borderRadius: 2, cursor: 'pointer', opacity: isDragging ? 0.4 : 1,
          border: selectedProject?.id === project.id ? `2px solid ${COLORS.emerald}` : '1px solid #e0e0e0',
          transition: 'all 0.2s', mb: 1.5,
          '&:hover': { transform: 'translateY(-1px)', boxShadow: 3 },
        }}
        onClick={() => loadProjectDetail(project.id, projectViewMode !== 'detailed')}
      >
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1, mr: 1 }}>{project.name}</Typography>
            <Box>
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditingProject({ ...project, label_ids: project.labels?.map(l => l.id) || [] }); setProjectDialogOpen(true); }}>
                <Edit fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'project', id: project.id }); setDeleteConfirmOpen(true); }}>
                <Delete fontSize="small" />
              </IconButton>
            </Box>
          </Box>
          {project.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
              {project.description}
            </Typography>
          )}
          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 1 }}>
            {statusChip(project.status, STATUS_CONFIG)}
            {priorityChip(project.priority)}
            {project.task_count > 0 && <Chip label={`${project.task_count} tasks`} size="small" variant="outlined" />}
          </Stack>
          {project.labels?.length > 0 && (
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 1 }}>
              {project.labels.map(l => <Chip key={l.id} label={l.name} size="small" sx={{ bgcolor: l.color + '22', color: l.color, fontSize: '0.7rem' }} />)}
            </Stack>
          )}
          {project.task_count > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <LinearProgress variant="determinate" value={project.progress_percent} sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: statusCfg.color } }} />
              <Typography variant="caption" fontWeight={600}>{project.progress_percent}%</Typography>
            </Box>
          )}
          {(project.estimated_hours || project.actual_hours) && (
            <Typography variant="caption" color="text.secondary">
              {project.estimated_hours ? `Est: ${project.estimated_hours}h` : ''}{project.actual_hours ? ` / Actual: ${project.actual_hours}h` : ''}
            </Typography>
          )}
        </CardContent>
      </Card>
    );
  };

  // ========== TASK ROW (List View) ==========
  const renderTaskRow = (task: Task) => {
    const tsCfg = TASK_STATUS_CONFIG[task.status] || TASK_STATUS_CONFIG.backlog;
    return (
      <Paper key={task.id} sx={{ p: 1.5, mb: 1, display: 'flex', alignItems: 'center', gap: 1.5, borderRadius: 2 }}>
        <Checkbox
          size="small"
          checked={task.status === 'done'}
          onChange={() => {
            if (task.status === 'done') {
              handleQuickStatusChange(task.id, taskPrevStatus[task.id] || 'todo');
            } else {
              setTaskPrevStatus(prev => ({ ...prev, [task.id]: task.status }));
              handleQuickStatusChange(task.id, 'done');
            }
          }}
        />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>
            {task.title}
          </Typography>
          {task.description && <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.description}</Typography>}
        </Box>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {statusChip(task.status, TASK_STATUS_CONFIG)}
          {priorityChip(task.priority)}
          {(task.comments?.length || 0) > 0 && (
            <Badge badgeContent={task.comments?.length} color="primary" sx={{ '& .MuiBadge-badge': { fontSize: '0.65rem' } }}>
              <Comment fontSize="small" color="action" />
            </Badge>
          )}
          {(task.notes?.length || 0) > 0 && (
            <Badge badgeContent={task.notes?.length} sx={{ '& .MuiBadge-badge': { bgcolor: '#ff9800', color: '#fff', fontSize: '0.65rem' } }}>
              <StickyNote2 fontSize="small" color="action" />
            </Badge>
          )}
          <IconButton size="small" onClick={() => { setEditingTask(task); setTaskDialogOpen(true); setShowAudit(false); }}>
            <Edit fontSize="small" />
          </IconButton>
          <IconButton size="small" color="error" onClick={() => { setDeleteTarget({ type: 'task', id: task.id }); setDeleteConfirmOpen(true); }}>
            <Delete fontSize="small" />
          </IconButton>
        </Stack>
      </Paper>
    );
  };

  // ========== TASK KANBAN CARD ==========
  const renderTaskKanbanCard = (task: Task) => (
    <Card
      key={task.id}
      draggable
      onDragStart={(e) => { setDraggedTaskId(task.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { setDraggedTaskId(null); setDragOverColumn(null); }}
      sx={{
        mb: 1, cursor: 'grab', opacity: draggedTaskId === task.id ? 0.4 : 1,
        borderRadius: 2, '&:hover': { boxShadow: 3 },
        borderLeft: `3px solid ${(PRIORITY_CONFIG[task.priority] || PRIORITY_CONFIG.medium).color}`,
      }}
      onClick={() => { setEditingTask(task); setTaskDialogOpen(true); setShowAudit(false); }}
    >
      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{task.title}</Typography>
        <Stack direction="row" spacing={0.5} flexWrap="wrap">
          {priorityChip(task.priority)}

          {task.story_points && <Chip label={`${task.story_points} SP`} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />}
        </Stack>
      </CardContent>
    </Card>
  );

  // ========== TASK KANBAN VIEW ==========
  const renderTaskKanban = (tasks: Task[]) => (
    <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
      {TASK_STATUSES.map(status => {
        const cfg = TASK_STATUS_CONFIG[status];
        const colTasks = tasks.filter(t => t.status === status);
        return (
          <Paper
            key={status}
            sx={{
              minWidth: 240, flex: '0 0 240px', borderRadius: 2, bgcolor: dragOverColumn === status ? '#e8f5e9' : '#f5f5f5',
              transition: 'background-color 0.2s',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOverColumn(status); }}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => { e.preventDefault(); if (draggedTaskId) handleQuickStatusChange(draggedTaskId, status); setDragOverColumn(null); }}
          >
            <Box sx={{ p: 1.5, borderBottom: `3px solid ${cfg.color}` }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ color: cfg.color }}>
                {cfg.label} ({colTasks.length})
              </Typography>
            </Box>
            <Box sx={{ p: 1, minHeight: 100 }}>
              {colTasks.map(t => renderTaskKanbanCard(t))}
            </Box>
          </Paper>
        );
      })}
    </Box>
  );

  // ========== TASK SWIMLANE VIEW ==========
  const renderTaskSwimlane = (tasks: Task[]) => (
    <Box>
      {TASK_STATUSES.map(status => {
        const cfg = TASK_STATUS_CONFIG[status];
        const rowTasks = tasks.filter(t => t.status === status);
        return (
          <Box
            key={status}
            sx={{
              display: 'flex', mb: 1.5, borderRadius: 2, overflow: 'hidden',
              bgcolor: dragOverColumn === status ? '#e8f5e960' : 'transparent',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOverColumn(status); }}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => { e.preventDefault(); if (draggedTaskId) handleQuickStatusChange(draggedTaskId, status); setDragOverColumn(null); }}
          >
            <Box sx={{ minWidth: 120, p: 1.5, bgcolor: cfg.bg, display: 'flex', alignItems: 'center', borderLeft: `3px solid ${cfg.color}` }}>
              <Typography variant="caption" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label} ({rowTasks.length})</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, p: 1, flex: 1, overflowX: 'auto', minHeight: 60 }}>
              {rowTasks.map(t => renderTaskKanbanCard(t))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  // ========== PROJECT KANBAN VIEW ==========
  const renderProjectKanban = () => (
    <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
      {PROJECT_STATUSES.map(status => {
        const cfg = STATUS_CONFIG[status];
        const colProjects = filteredProjects.filter(p => p.status === status);
        return (
          <Paper
            key={status}
            sx={{
              minWidth: 280, flex: '0 0 280px', borderRadius: 2,
              bgcolor: dragOverProjectColumn === status ? '#e8f5e9' : '#fafafa',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOverProjectColumn(status); }}
            onDragLeave={() => setDragOverProjectColumn(null)}
            onDrop={(e) => { e.preventDefault(); if (draggedProjectId) handleQuickProjectStatusChange(draggedProjectId, status); setDragOverProjectColumn(null); }}
          >
            <Box sx={{ p: 1.5, borderBottom: `3px solid ${cfg.color}` }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ color: cfg.color }}>
                {cfg.label} ({colProjects.length})
              </Typography>
            </Box>
            <Box sx={{ p: 1 }}>
              {colProjects.map(p => renderProjectCard(p, { draggable: true }))}
            </Box>
          </Paper>
        );
      })}
    </Box>
  );

  // ========== PROJECT SWIMLANE VIEW ==========
  const renderProjectSwimlane = () => (
    <Box>
      {PROJECT_STATUSES.map(status => {
        const cfg = STATUS_CONFIG[status];
        const rowProjects = filteredProjects.filter(p => p.status === status);
        return (
          <Box
            key={status}
            sx={{
              display: 'flex', mb: 1.5, borderRadius: 2, overflow: 'hidden',
              bgcolor: dragOverProjectColumn === status ? '#e8f5e960' : 'transparent',
            }}
            onDragOver={(e) => { e.preventDefault(); setDragOverProjectColumn(status); }}
            onDragLeave={() => setDragOverProjectColumn(null)}
            onDrop={(e) => { e.preventDefault(); if (draggedProjectId) handleQuickProjectStatusChange(draggedProjectId, status); setDragOverProjectColumn(null); }}
          >
            <Box sx={{ minWidth: 130, p: 1.5, bgcolor: cfg.bg, display: 'flex', alignItems: 'center', borderLeft: `3px solid ${cfg.color}` }}>
              <Typography variant="caption" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label} ({rowProjects.length})</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5, p: 1, flex: 1, overflowX: 'auto' }}>
              {rowProjects.map(p => (
                <Box key={p.id} sx={{ minWidth: 260 }}>
                  {renderProjectCard(p, { draggable: true })}
                </Box>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  // ========== PROJECT LIST VIEW ==========
  const renderProjectList = () => (
    <Box>
      {filteredProjects.map(project => {
        const statusCfg = STATUS_CONFIG[project.status] || STATUS_CONFIG.backlog;
        return (
          <Paper
            key={project.id}
            sx={{
              p: 2, mb: 1, cursor: 'pointer', borderRadius: 2, display: 'flex', alignItems: 'center', gap: 2,
              border: selectedProject?.id === project.id ? `2px solid ${COLORS.emerald}` : '1px solid #e0e0e0',
              '&:hover': { bgcolor: '#f5f5f5' },
            }}
            onClick={() => loadProjectDetail(project.id, true)}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="subtitle1" fontWeight={600}>{project.name}</Typography>
                {project.task_count > 0 && <Chip label={`${project.task_count} tasks`} size="small" variant="outlined" />}
                {project.labels?.map(l => <Chip key={l.id} label={l.name} size="small" sx={{ bgcolor: l.color + '22', color: l.color, fontSize: '0.68rem' }} />)}
              </Stack>
            </Box>
            <Stack direction="row" spacing={1} alignItems="center">
              {statusChip(project.status, STATUS_CONFIG)}
              {priorityChip(project.priority)}
              {project.task_count > 0 && (
                <Box sx={{ width: 80, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <LinearProgress variant="determinate" value={project.progress_percent} sx={{ flex: 1, height: 6, borderRadius: 3, '& .MuiLinearProgress-bar': { bgcolor: statusCfg.color } }} />
                  <Typography variant="caption" fontWeight={600}>{project.progress_percent}%</Typography>
                </Box>
              )}
              {project.estimated_hours && <Typography variant="caption" color="text.secondary">{project.estimated_hours}h</Typography>}
              <IconButton size="small" onClick={(e) => { e.stopPropagation(); setEditingProject({ ...project, label_ids: project.labels?.map(l => l.id) || [] }); setProjectDialogOpen(true); }}>
                <Edit fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={(e) => { e.stopPropagation(); setDeleteTarget({ type: 'project', id: project.id }); setDeleteConfirmOpen(true); }}>
                <Delete fontSize="small" />
              </IconButton>
            </Stack>
          </Paper>
        );
      })}
    </Box>
  );

  // ========== DETAILED (SPLIT) VIEW ==========
  const renderDetailedView = () => (
    <Box sx={{ display: 'flex', gap: 2, height: 'calc(100vh - 240px)' }}>
      <Box sx={{ width: '33%', overflowY: 'auto', pr: 1 }}>
        {filteredProjects.map(p => renderProjectCard(p))}
      </Box>
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {selectedProject ? renderProjectDetailInline() : (
          <Paper sx={{ p: 4, display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100%', bgcolor: '#fafafa', borderRadius: 2 }}>
            <Typography color="text.secondary">Select a project to view details</Typography>
          </Paper>
        )}
      </Box>
    </Box>
  );

  // ========== PROJECT DETAIL INLINE (for detailed/modal views) ==========
  const renderProjectDetailInline = () => {
    if (!selectedProject) return null;
    const sp = selectedProject;
    const statusCfg = STATUS_CONFIG[sp.status] || STATUS_CONFIG.backlog;
    const doneTasks = sp.tasks?.filter(t => t.status === 'done').length || 0;
    const totalTasks = sp.tasks?.length || 0;
    return (
      <Box>
        {/* Header */}
        <Paper sx={{
          p: 3, mb: 2, borderRadius: 2,
          background: `linear-gradient(135deg, ${COLORS.darkForest} 0%, ${COLORS.emerald} 100%)`,
          color: 'white',
        }}>
          <Typography variant="h5" fontWeight={700}>{sp.name}</Typography>
          {sp.description && <Typography variant="body2" sx={{ mt: 1, opacity: 0.9 }}>{sp.description}</Typography>}
          <Stack direction="row" spacing={1} sx={{ mt: 2 }} flexWrap="wrap">
            <Chip label={statusCfg.label} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff', fontWeight: 600 }} />
            <Chip label={(PRIORITY_CONFIG[sp.priority] || PRIORITY_CONFIG.medium).label} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} />
            {totalTasks > 0 && <Chip label={`${doneTasks}/${totalTasks} tasks done`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} />}
            {sp.estimated_hours && <Chip label={`Est: ${sp.estimated_hours}h`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} />}
            {sp.location && (
              <Chip icon={<FolderOpen fontSize="small" />} label={sp.location} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff', maxWidth: 300 }} />
            )}
          </Stack>
          {sp.labels?.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 1 }}>
              {sp.labels.map(l => <Chip key={l.id} label={l.name} size="small" sx={{ bgcolor: l.color + '44', color: '#fff', fontSize: '0.7rem' }} />)}
            </Stack>
          )}
        </Paper>

        {/* Task controls */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <ToggleButtonGroup size="small" exclusive value={taskViewMode} onChange={(_, v) => v && setTaskViewMode(v)}>
            <ToggleButton value="list"><ViewList fontSize="small" /></ToggleButton>
            <ToggleButton value="kanban"><ViewModule fontSize="small" /></ToggleButton>
            <ToggleButton value="swimlane"><ViewStream fontSize="small" /></ToggleButton>
          </ToggleButtonGroup>
          <Button variant="contained" startIcon={<Add />} size="small" onClick={() => { setEditingTask({ status: 'backlog', priority: 'medium', task_type: 'task' }); setTaskDialogOpen(true); setShowAudit(false); }}>
            New Task
          </Button>
        </Box>

        {/* Tasks */}
        {taskViewMode === 'list' && (sp.tasks || []).map(t => renderTaskRow(t))}
        {taskViewMode === 'kanban' && renderTaskKanban(sp.tasks || [])}
        {taskViewMode === 'swimlane' && renderTaskSwimlane(sp.tasks || [])}
      </Box>
    );
  };

  // ========== MAIN RENDER ==========
  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ px: 3, py: 2, maxWidth: 1600, mx: 'auto' }}>
      {/* Header */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight={700} sx={{ color: COLORS.darkForest }}>
          Projects
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={() => setLabelsDialogOpen(true)}>Labels</Button>
          <Button variant="contained" startIcon={<Add />} onClick={() => { setEditingProject({ status: 'backlog', priority: 'medium' }); setProjectDialogOpen(true); }}>
            New Project
          </Button>
        </Stack>
      </Box>

      {/* Filters */}
      <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Stack direction="row" spacing={2} alignItems="center" flexWrap="wrap">
          <TextField
            size="small" placeholder="Search projects..." value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ minWidth: 200 }}
            InputProps={{ startAdornment: <FilterList fontSize="small" sx={{ mr: 0.5, color: 'action.active' }} /> }}
          />
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Status</InputLabel>
            <Select value={filterStatus} label="Status" onChange={(e) => setFilterStatus(e.target.value)}>
              <MenuItem value="">All</MenuItem>
              {Array.from(availableStatuses).map(s => <MenuItem key={s} value={s}>{(STATUS_CONFIG[s] || {}).label || s}</MenuItem>)}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel>Priority</InputLabel>
            <Select value={filterPriority} label="Priority" onChange={(e) => setFilterPriority(e.target.value)}>
              <MenuItem value="">All</MenuItem>
              {Array.from(availablePriorities).map(p => <MenuItem key={p} value={p}>{(PRIORITY_CONFIG[p] || {}).label || p}</MenuItem>)}
            </Select>
          </FormControl>
          {(filterStatus || filterPriority || searchQuery || filterLabel.length > 0) && (
            <Button size="small" onClick={() => { setFilterStatus(''); setFilterPriority(''); setSearchQuery(''); setFilterLabel([]); }}>
              Clear filters
            </Button>
          )}
        </Stack>
        {availableLabels.size > 0 && (
          <Stack direction="row" spacing={0.5} sx={{ mt: 1 }} flexWrap="wrap">
            {Array.from(availableLabels.values()).map(({ label: l, count }) => (
              <Chip
                key={l.id}
                label={`${l.name} (${count})`}
                size="small"
                variant={filterLabel.includes(l.id) ? 'filled' : 'outlined'}
                sx={{ bgcolor: filterLabel.includes(l.id) ? l.color + '33' : undefined, color: l.color, borderColor: l.color, cursor: 'pointer' }}
                onClick={() => setFilterLabel(prev => prev.includes(l.id) ? prev.filter(x => x !== l.id) : [...prev, l.id])}
              />
            ))}
          </Stack>
        )}
      </Paper>

      {/* View Mode Toggle */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <ToggleButtonGroup size="small" exclusive value={projectViewMode} onChange={(_, v) => v && setProjectViewMode(v)}>
          <ToggleButton value="list"><ViewList fontSize="small" sx={{ mr: 0.5 }} /> List</ToggleButton>
          <ToggleButton value="kanban"><ViewModule fontSize="small" sx={{ mr: 0.5 }} /> Kanban</ToggleButton>
          <ToggleButton value="swimlane"><ViewStream fontSize="small" sx={{ mr: 0.5 }} /> Swimlane</ToggleButton>
          <ToggleButton value="detailed"><Assignment fontSize="small" sx={{ mr: 0.5 }} /> Detailed</ToggleButton>
        </ToggleButtonGroup>
        <Typography variant="body2" color="text.secondary">{filteredProjects.length} projects</Typography>
      </Box>

      {/* Project Views */}
      {projectViewMode === 'list' && renderProjectList()}
      {projectViewMode === 'kanban' && renderProjectKanban()}
      {projectViewMode === 'swimlane' && renderProjectSwimlane()}
      {projectViewMode === 'detailed' && renderDetailedView()}

      {filteredProjects.length === 0 && !loading && (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 2, bgcolor: '#fafafa' }}>
          <Typography color="text.secondary">No projects found. Create your first project!</Typography>
        </Paper>
      )}

      {/* ========== PROJECT DETAIL MODAL ========== */}
      <Dialog
        open={tileDetailOpen}
        onClose={() => setTileDetailOpen(false)}
        maxWidth={tileDetailExpanded ? false : 'lg'}
        fullWidth
        fullScreen={tileDetailExpanded}
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography variant="h6" fontWeight={700}>{selectedProject?.name || 'Project Detail'}</Typography>
          <Box>
            <IconButton onClick={() => setTileDetailExpanded(!tileDetailExpanded)}>
              {tileDetailExpanded ? <CloseFullscreen /> : <OpenInFull />}
            </IconButton>
            <IconButton onClick={() => setTileDetailOpen(false)}><Close /></IconButton>
          </Box>
        </DialogTitle>
        <DialogContent dividers>
          {renderProjectDetailInline()}
        </DialogContent>
      </Dialog>

      {/* ========== PROJECT CREATE/EDIT DIALOG ========== */}
      <Dialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingProject?.id ? 'Edit Project' : 'New Project'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Name" required fullWidth value={editingProject?.name || ''} onChange={(e) => setEditingProject(prev => prev ? { ...prev, name: e.target.value } : prev)} />
            <TextField label="Description" multiline rows={3} fullWidth value={editingProject?.description || ''} onChange={(e) => setEditingProject(prev => prev ? { ...prev, description: e.target.value } : prev)} />
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select value={editingProject?.status || 'backlog'} label="Status" onChange={(e) => setEditingProject(prev => prev ? { ...prev, status: e.target.value } : prev)}>
                  {PROJECT_STATUSES.map(s => <MenuItem key={s} value={s}>{STATUS_CONFIG[s]?.label || s}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Priority</InputLabel>
                <Select value={editingProject?.priority || 'medium'} label="Priority" onChange={(e) => setEditingProject(prev => prev ? { ...prev, priority: e.target.value } : prev)}>
                  {Object.entries(PRIORITY_CONFIG).map(([v, c]) => <MenuItem key={v} value={v}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
            <TextField label="Location (path or URL)" fullWidth value={editingProject?.location || ''} onChange={(e) => setEditingProject(prev => prev ? { ...prev, location: e.target.value } : prev)} />
            <Stack direction="row" spacing={2}>
              <TextField label="Estimated Hours" type="number" fullWidth value={editingProject?.estimated_hours ?? ''} onChange={(e) => setEditingProject(prev => prev ? { ...prev, estimated_hours: e.target.value ? parseFloat(e.target.value) : null } : prev)} />
              <TextField label="Target Date" type="date" fullWidth InputLabelProps={{ shrink: true }} value={editingProject?.target_date || ''} onChange={(e) => setEditingProject(prev => prev ? { ...prev, target_date: e.target.value || null } : prev)} />
            </Stack>
            {allLabels.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>Labels</InputLabel>
                <Select
                  multiple
                  value={(editingProject as any)?.label_ids || []}
                  onChange={(e) => setEditingProject(prev => prev ? { ...prev, label_ids: e.target.value as number[] } : prev)}
                  input={<OutlinedInput label="Labels" />}
                  renderValue={(selected) => (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                      {(selected as number[]).map(id => {
                        const l = allLabels.find(x => x.id === id);
                        return l ? <Chip key={id} label={l.name} size="small" sx={{ bgcolor: l.color + '22', color: l.color }} /> : null;
                      })}
                    </Stack>
                  )}
                >
                  {allLabels.map(l => (
                    <MenuItem key={l.id} value={l.id}>
                      <Checkbox checked={((editingProject as any)?.label_ids || []).includes(l.id)} />
                      <Box sx={{ width: 14, height: 14, borderRadius: '50%', bgcolor: l.color, mr: 1 }} />
                      <ListItemText primary={l.name} />
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setProjectDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveProject}>{editingProject?.id ? 'Save' : 'Create'}</Button>
        </DialogActions>
      </Dialog>

      {/* ========== TASK CREATE/EDIT DIALOG ========== */}
      <Dialog open={taskDialogOpen} onClose={() => setTaskDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{editingTask?.id ? 'Edit Task' : 'New Task'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Title" required fullWidth value={editingTask?.title || ''} onChange={(e) => setEditingTask(prev => prev ? { ...prev, title: e.target.value } : prev)} />
            <TextField label="Description" multiline minRows={5} maxRows={20} fullWidth value={editingTask?.description || ''} onChange={(e) => setEditingTask(prev => prev ? { ...prev, description: e.target.value } : prev)} InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }} />
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Type</InputLabel>
                <Select value={editingTask?.task_type || 'task'} label="Type" onChange={(e) => setEditingTask(prev => prev ? { ...prev, task_type: e.target.value } : prev)}>
                  {['task', 'story', 'bug', 'epic', 'subtask'].map(t => <MenuItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Status</InputLabel>
                <Select value={editingTask?.status || 'backlog'} label="Status" onChange={(e) => setEditingTask(prev => prev ? { ...prev, status: e.target.value } : prev)}>
                  {TASK_STATUSES.map(s => <MenuItem key={s} value={s}>{TASK_STATUS_CONFIG[s]?.label || s}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Priority</InputLabel>
                <Select value={editingTask?.priority || 'medium'} label="Priority" onChange={(e) => setEditingTask(prev => prev ? { ...prev, priority: e.target.value } : prev)}>
                  {Object.entries(PRIORITY_CONFIG).map(([v, c]) => <MenuItem key={v} value={v}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Story Points" type="number" fullWidth value={editingTask?.story_points ?? ''} onChange={(e) => setEditingTask(prev => prev ? { ...prev, story_points: e.target.value ? parseInt(e.target.value) : null } : prev)} />
              <TextField label="Estimated Hours" type="number" fullWidth value={editingTask?.estimated_hours ?? ''} onChange={(e) => setEditingTask(prev => prev ? { ...prev, estimated_hours: e.target.value ? parseFloat(e.target.value) : null } : prev)} />
            </Stack>
            <TextField label="Due Date" type="date" fullWidth InputLabelProps={{ shrink: true }} value={editingTask?.due_date || ''} onChange={(e) => setEditingTask(prev => prev ? { ...prev, due_date: e.target.value || null } : prev)} />

            {/* --- Comments, Notes, Audit (only for existing tasks) --- */}
            {editingTask?.id && (
              <>
                <Divider sx={{ my: 2 }} />

                {/* Comments */}
                <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Comment fontSize="small" /> Comments ({editingTask.comments?.length || 0})
                </Typography>
                <Box sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 1 }}>
                  {(editingTask.comments || []).map((c: any) => (
                    <Box key={c.id} sx={{ mb: 1, p: 1, bgcolor: '#fff', borderRadius: 1 }}>
                      <Typography variant="caption" fontWeight={600}>{c.author}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{c.created_at ? new Date(c.created_at).toLocaleString() : ''}</Typography>
                      <Typography variant="body2">{c.content}</Typography>
                    </Box>
                  ))}
                </Box>
                <Stack direction="row" spacing={1}>
                  <TextField size="small" fullWidth placeholder="Add comment..." value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && editingTask?.id) { e.preventDefault(); handleAddComment(editingTask.id); } }}
                  />
                  <Button variant="contained" size="small" onClick={() => editingTask?.id && handleAddComment(editingTask.id)}>Send</Button>
                </Stack>

                {/* Notes */}
                <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 2 }}>
                  <StickyNote2 fontSize="small" /> Notes ({editingTask.notes?.length || 0})
                </Typography>
                <Box sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 1 }}>
                  {(editingTask.notes || []).map((n: TaskNote) => {
                    const borderColors = { bug: '#c62828', note: '#1565c0', idea: '#ff9800' };
                    const icons = { bug: <BugReport fontSize="small" />, note: <NoteAlt fontSize="small" />, idea: <Lightbulb fontSize="small" /> };
                    return (
                      <Box key={n.id} sx={{ mb: 1, p: 1, bgcolor: '#fff', borderRadius: 1, borderLeft: `3px solid ${borderColors[n.note_type as keyof typeof borderColors] || '#999'}` }}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {icons[n.note_type as keyof typeof icons]}
                          <Typography variant="caption" fontWeight={600}>{n.author}</Typography>
                          <Typography variant="caption" color="text.secondary">{n.created_at ? new Date(n.created_at).toLocaleString() : ''}</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ textDecoration: n.resolved ? 'line-through' : 'none', opacity: n.resolved ? 0.6 : 1 }}>
                          {n.content}
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                          {n.note_type === 'bug' && (
                            <FormControlLabel
                              control={<Checkbox size="small" checked={n.resolved} onChange={() => handleToggleNoteResolved(n.id)} />}
                              label={<Typography variant="caption">Resolved</Typography>}
                            />
                          )}
                          {n.note_type === 'idea' && !n.promoted_task_id && (
                            <Button size="small" startIcon={<Rocket fontSize="small" />} onClick={() => handlePromoteIdea(n.id)}>Promote to Task</Button>
                          )}
                          {n.promoted_task_id && (
                            <Chip label={`Promoted → Task #${n.promoted_task_id}`} size="small" color="success" variant="outlined" icon={<CheckCircle fontSize="small" />} />
                          )}
                        </Stack>
                      </Box>
                    );
                  })}
                </Box>
                <Stack direction="row" spacing={1}>
                  <FormControl size="small" sx={{ minWidth: 100 }}>
                    <Select value={noteType} onChange={(e) => setNoteType(e.target.value as any)}>
                      <MenuItem value="note">Note</MenuItem>
                      <MenuItem value="bug">Bug</MenuItem>
                      <MenuItem value="idea">Idea</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" fullWidth placeholder="Add note..." value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                  <Button variant="contained" size="small" onClick={() => editingTask?.id && handleAddNote(editingTask.id)}>Add</Button>
                </Stack>

                {/* Audit */}
                <FormControlLabel
                  control={<Switch size="small" checked={showAudit} onChange={() => setShowAudit(!showAudit)} />}
                  label={<Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><History fontSize="small" /> Audit Log</Typography>}
                  sx={{ mt: 2 }}
                />
                {showAudit && (
                  <Box sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 1 }}>
                    {(editingTask.audit_logs || []).sort((a: TaskAudit, b: TaskAudit) => new Date(b.changed_at || 0).getTime() - new Date(a.changed_at || 0).getTime()).map((a: TaskAudit) => (
                      <Box key={a.id} sx={{ mb: 0.5, p: 1, bgcolor: '#fff', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" fontWeight={600}>{a.changed_by}</Typography>
                        <Chip label={a.field} size="small" variant="outlined" sx={{ fontSize: '0.65rem' }} />
                        {a.old_value && <Chip label={a.old_value} size="small" sx={{ bgcolor: '#ffebee', color: '#c62828', textDecoration: 'line-through', fontSize: '0.65rem' }} />}
                        <ArrowForward sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Chip label={a.new_value || '(empty)'} size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontSize: '0.65rem' }} />
                        <Typography variant="caption" color="text.secondary">{a.changed_at ? new Date(a.changed_at).toLocaleString() : ''}</Typography>
                      </Box>
                    ))}
                    {(!editingTask.audit_logs || editingTask.audit_logs.length === 0) && (
                      <Typography variant="caption" color="text.secondary">No changes recorded yet.</Typography>
                    )}
                  </Box>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setTaskDialogOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleSaveTask}>{editingTask?.id ? 'Save' : 'Create'}</Button>
        </DialogActions>
      </Dialog>

      {/* ========== DELETE CONFIRM DIALOG ========== */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>Confirm Delete</DialogTitle>
        <DialogContent>
          <Typography>Are you sure you want to delete this {deleteTarget?.type}? This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Cancel</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Delete</Button>
        </DialogActions>
      </Dialog>

      {/* ========== LABELS MANAGEMENT DIALOG ========== */}
      <Dialog open={labelsDialogOpen} onClose={() => setLabelsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Manage Labels</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="Label name" value={editingLabel.name} onChange={(e) => setEditingLabel(prev => ({ ...prev, name: e.target.value }))} sx={{ flex: 1 }} />
              <TextField size="small" label="Color" type="color" value={editingLabel.color} onChange={(e) => setEditingLabel(prev => ({ ...prev, color: e.target.value }))} sx={{ width: 80 }} />
              <Button variant="contained" size="small" onClick={handleSaveLabel}>Add</Button>
            </Stack>
            <Divider />
            {allLabels.map(l => (
              <Stack key={l.id} direction="row" spacing={1} alignItems="center">
                <Box sx={{ width: 18, height: 18, borderRadius: '50%', bgcolor: l.color }} />
                <Typography variant="body2" sx={{ flex: 1 }}>{l.name}</Typography>
                <IconButton size="small" color="error" onClick={() => handleDeleteLabel(l.id)}><Delete fontSize="small" /></IconButton>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLabelsDialogOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
