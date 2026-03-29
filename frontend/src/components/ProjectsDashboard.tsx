import { useState, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
import {
  Box, Typography, Card, CardContent, Chip, Button, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, LinearProgress,
  Paper, Stack, CircularProgress, Snackbar, Alert, Badge,
  Checkbox, OutlinedInput, ListItemText, Collapse,
  ToggleButton, ToggleButtonGroup, Divider, Switch, FormControlLabel, Tooltip,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import {
  Add, Edit, Delete, FolderOpen, ArrowBack,
  Schedule, Science, ViewModule, ViewList, ViewStream,
  FilterList, PriorityHigh, Flag, PlayArrow, Pause, Done, Block,
  ExpandMore, ChevronRight, SubdirectoryArrowRight,
  BugReport, Lightbulb, NoteAlt, CheckCircle,
  Rocket, History, StickyNote2, Comment, ArrowForward, MenuBook,
} from '@mui/icons-material';
import projectsApi from '../api/projects';
import type { Project, Task, ProjectDetail, Label, TaskNote, TaskAudit } from '../api/projects';

const COLORS = { darkForest: '#00472e', emerald: '#007638' };

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon?: ReactElement }> = {
  backlog:     { label: 'Nápad',      color: '#9c27b0', bg: '#f3e5f5', icon: <Schedule fontSize="small" /> },
  planning:    { label: 'Plánování', color: '#1565c0', bg: '#e3f2fd' },
  in_progress: { label: 'Probíhá', color: COLORS.emerald, bg: '#e8f5e9', icon: <PlayArrow fontSize="small" /> },
  testing:     { label: 'Testování', color: '#e65100', bg: '#fff3e0', icon: <Science fontSize="small" /> },
  review:      { label: 'Review',     color: '#f57c00', bg: '#fff8e1', icon: <Pause fontSize="small" /> },
  done:        { label: 'Hotovo',     color: '#2e7d32', bg: '#c8e6c9', icon: <Done fontSize="small" /> },
  archived:    { label: 'Blokováno', color: '#c62828', bg: '#ffebee', icon: <Block fontSize="small" /> },
};

const TASK_CFG: Record<string, { label: string; color: string; bg: string }> = {
  backlog:     { label: 'Nápad',      color: '#9c27b0', bg: '#f3e5f5' },
  todo:        { label: 'Plánováno', color: '#1565c0', bg: '#e3f2fd' },
  in_progress: { label: 'Probíhá', color: COLORS.emerald, bg: '#e8f5e9' },
  testing:     { label: 'Testování', color: '#e65100', bg: '#fff3e0' },
  review:      { label: 'Review',     color: '#f57c00', bg: '#fff8e1' },
  done:        { label: 'Hotovo',     color: '#2e7d32', bg: '#c8e6c9' },
  blocked:     { label: 'Blokováno', color: '#c62828', bg: '#ffebee' },
};

const PRI_CFG: Record<string, { label: string; color: string; icon?: ReactElement }> = {
  low:      { label: 'Nízká', color: '#66bb6a' },
  medium:   { label: 'Střední', color: '#ffa726' },
  high:     { label: 'Vysoká', color: '#ef5350', icon: <PriorityHigh fontSize="small" /> },
  critical: { label: 'Kritická', color: '#c62828', icon: <Flag fontSize="small" /> },
};

const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'testing', 'review', 'done', 'blocked'];
const PROJ_STATUSES = ['backlog', 'planning', 'in_progress', 'testing', 'review', 'done', 'archived'];

export default function ProjectsDashboard() {
  const [view, setView] = useState<'overview' | 'project'>('overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [searchQuery, setSearchQuery] = useState('');
  const [taskViewMode, setTaskViewMode] = useState<'list' | 'kanban' | 'swimlane'>('list');
  const [expandedUkoly, setExpandedUkoly] = useState<Set<number>>(new Set());
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [taskPrevStatus, setTaskPrevStatus] = useState<Record<number, string>>({});
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Partial<Project> & { label_ids?: number[] } | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [parentForNewTask, setParentForNewTask] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'project' | 'task'; id: number } | null>(null);
  const [labelsDialogOpen, setLabelsDialogOpen] = useState(false);
  const [editingLabel, setEditingLabel] = useState<{ name: string; color: string; description: string }>({ name: '', color: '#4caf50', description: '' });
  const [commentText, setCommentText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<'bug' | 'note' | 'idea'>('note');
  const [showAudit, setShowAudit] = useState(false);

  const showSnack = (message: string, severity: 'success' | 'error' = 'success') =>
    setSnackbar({ open: true, message, severity });

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const [pl, ll] = await Promise.all([projectsApi.list(), projectsApi.listLabels()]);
      setProjects(pl);
      setAllLabels(ll);
    } catch {
      showSnack('Nepodařilo se načíst projekty', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadProjects(); }, [loadProjects]);

  const loadProjectDetail = useCallback(async (id: number) => {
    try {
      const detail = await projectsApi.get(id);
      setSelectedProject(detail);
    } catch {
      showSnack('Nepodařilo se načíst projekt', 'error');
    }
  }, []);

  const openProject = async (id: number) => {
    await loadProjectDetail(id);
    setView('project');
    setExpandedUkoly(new Set());
  };

  const goBack = () => {
    setView('overview');
    setSelectedProject(null);
    loadProjects();
  };

  const sChip = (status: string, cfg: Record<string, { label: string; color: string; bg: string }>) => {
    const c = cfg[status] || { label: status, color: '#666', bg: '#eee' };
    return <Chip label={c.label} size="small" sx={{ bgcolor: c.bg, color: c.color, fontWeight: 600, fontSize: '0.72rem' }} />;
  };

  const pChip = (priority: string) => {
    const c = PRI_CFG[priority] || PRI_CFG.medium;
    return <Chip label={c.label} size="small" icon={c.icon} sx={{ bgcolor: c.color + '22', color: c.color, fontWeight: 600, fontSize: '0.72rem' }} />;
  };

  const handleSaveProject = async () => {
    if (!editingProject?.name) return;
    try {
      if (editingProject.id) {
        await projectsApi.update(editingProject.id, editingProject);
        if (selectedProject?.id === editingProject.id) loadProjectDetail(editingProject.id);
        showSnack('Projekt uložen');
      } else {
        await projectsApi.create(editingProject);
        showSnack('Projekt vytvořen');
      }
      setProjectDialogOpen(false);
      setEditingProject(null);
      loadProjects();
    } catch { showSnack('Nepodařilo se uložit projekt', 'error'); }
  };

  const handleSaveTask = async () => {
    if (!editingTask?.title || !selectedProject) return;
    try {
      if (editingTask.id) {
        await projectsApi.updateTask(editingTask.id, editingTask);
        showSnack('Uloženo');
      } else {
        await projectsApi.createTask(selectedProject.id, { ...editingTask, parent_task_id: parentForNewTask });
        showSnack(parentForNewTask ? 'Pod-úkol přidán' : 'Úkol přidán');
      }
      setTaskDialogOpen(false); setEditingTask(null); setParentForNewTask(null);
      loadProjectDetail(selectedProject.id); loadProjects();
    } catch { showSnack('Nepodařilo se uložit', 'error'); }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      if (deleteTarget.type === 'project') {
        await projectsApi.delete(deleteTarget.id);
        if (view === 'project') goBack(); else loadProjects();
        showSnack('Projekt smazán');
      } else {
        await projectsApi.deleteTask(deleteTarget.id);
        showSnack('Smazáno');
        if (selectedProject) loadProjectDetail(selectedProject.id);
        loadProjects();
      }
    } catch { showSnack('Nepodařilo se smazat', 'error');
    } finally { setDeleteConfirmOpen(false); setDeleteTarget(null); }
  };

  const quickStatus = async (taskId: number, newStatus: string) => {
    try {
      await projectsApi.updateTask(taskId, { status: newStatus } as any);
      if (selectedProject) loadProjectDetail(selectedProject.id);
    } catch { showSnack('Chyba při změně stavu', 'error'); }
  };

  const handleAddComment = async (taskId: number) => {
    if (!commentText.trim()) return;
    try {
      await projectsApi.addComment(taskId, commentText);
      setCommentText('');
      const t = await projectsApi.getTask(taskId);
      setEditingTask(t);
      if (selectedProject) loadProjectDetail(selectedProject.id);
    } catch { showSnack('Chyba', 'error'); }
  };

  const handleAddNote = async (taskId: number) => {
    if (!noteText.trim()) return;
    try {
      const note = await projectsApi.addNote(taskId, noteType, noteText);
      setNoteText('');
      setEditingTask(p => p ? { ...p, notes: [...(p.notes || []), note] } : p);
      if (selectedProject) loadProjectDetail(selectedProject.id);
    } catch { showSnack('Chyba', 'error'); }
  };

  const handleToggleNote = async (noteId: number) => {
    try {
      const u = await projectsApi.toggleNoteResolved(noteId);
      setEditingTask(p => p ? { ...p, notes: (p.notes || []).map((n: TaskNote) => n.id === noteId ? u : n) } : p);
    } catch { showSnack('Chyba', 'error'); }
  };

  const handlePromote = async (noteId: number) => {
    try {
      const u = await projectsApi.promoteIdea(noteId);
      setEditingTask(p => p ? { ...p, notes: (p.notes || []).map((n: TaskNote) => n.id === noteId ? u : n) } : p);
      showSnack('Nápad povýšen na úkol!');
      if (selectedProject) loadProjectDetail(selectedProject.id);
    } catch { showSnack('Nepodařilo se povýšit', 'error'); }
  };

  const handleSaveLabel = async () => {
    if (!editingLabel.name) return;
    try {
      await projectsApi.createLabel(editingLabel);
      setEditingLabel({ name: '', color: '#4caf50', description: '' });
      const ll = await projectsApi.listLabels();
      setAllLabels(ll);
    } catch { showSnack('Chyba', 'error'); }
  };

  const handleDeleteLabel = async (id: number) => {
    try {
      await projectsApi.deleteLabel(id);
      setAllLabels(await projectsApi.listLabels());
    } catch { showSnack('Chyba', 'error'); }
  };

  const toggleUkol = (id: number) =>
    setExpandedUkoly(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const openTaskDialog = (task: Partial<Task> | null, parentId: number | null = null) => {
    setEditingTask(task ?? { status: 'backlog', priority: 'medium', task_type: 'task' });
    setParentForNewTask(parentId);
    setCommentText(''); setNoteText(''); setShowAudit(false);
    setTaskDialogOpen(true);
  };

  const filteredProjects = projects.filter(p =>
    !searchQuery
      || p.name.toLowerCase().includes(searchQuery.toLowerCase())
      || (p.description || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // ======== OVERVIEW ========
  const renderOverview = () => (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" fontWeight={700} sx={{ color: COLORS.darkForest }}>Projekty</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={() => setLabelsDialogOpen(true)}>Štítky</Button>
          <Button variant="contained" startIcon={<Add />}
            onClick={() => { setEditingProject({ status: 'backlog', priority: 'medium' }); setProjectDialogOpen(true); }}>
            Nový projekt
          </Button>
        </Stack>
      </Box>
      <TextField size="small" placeholder="Hledat projekty..." value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)} sx={{ mb: 3, minWidth: 280 }}
        InputProps={{ startAdornment: <FilterList fontSize="small" sx={{ mr: 0.5, color: 'action.active' }} /> }}
      />
      <Grid container spacing={2.5}>
        {filteredProjects.map(project => {
          const sc = STATUS_CFG[project.status] || STATUS_CFG.backlog;
          return (
            <Grid item xs={12} sm={6} md={4} key={project.id}>
              <Card sx={{ borderRadius: 3, cursor: 'pointer', height: '100%', border: '1px solid #e0e0e0', transition: 'all 0.2s', '&:hover': { transform: 'translateY(-2px)', boxShadow: 4, borderColor: COLORS.emerald } }}
                onClick={() => openProject(project.id)}>
                <CardContent sx={{ p: 2.5 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1.5 }}>
                    <Typography variant="h6" fontWeight={700} sx={{ flex: 1, mr: 1 }}>{project.name}</Typography>
                    <Box onClick={e => e.stopPropagation()}>
                      <IconButton size="small" onClick={() => { setEditingProject({ ...project, label_ids: project.labels?.map(l => l.id) || [] }); setProjectDialogOpen(true); }}><Edit fontSize="small" /></IconButton>
                      <IconButton size="small" color="error" onClick={() => { setDeleteTarget({ type: 'project', id: project.id }); setDeleteConfirmOpen(true); }}><Delete fontSize="small" /></IconButton>
                    </Box>
                  </Box>
                  {project.description && (
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {project.description}
                    </Typography>
                  )}
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 1.5 }}>
                    {sChip(project.status, STATUS_CFG)} {pChip(project.priority)}
                    {project.task_count > 0 && <Chip label={project.task_count + ' úkolů'} size="small" variant="outlined" />}
                    {project.docs_repo && <Chip icon={<MenuBook fontSize="small" />} label="Docs" size="small" sx={{ bgcolor: '#e3f2fd', color: '#1565c0' }} />}
                  </Stack>
                  {project.labels?.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mb: 1 }}>
                      {project.labels.map(l => <Chip key={l.id} label={l.name} size="small" sx={{ bgcolor: l.color + '22', color: l.color, fontSize: '0.68rem' }} />)}
                    </Stack>
                  )}
                  {project.task_count > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                      <LinearProgress variant="determinate" value={project.progress_percent}
                        sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: sc.color } }} />
                      <Typography variant="caption" fontWeight={700}>{project.progress_percent}%</Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          );
        })}
      </Grid>
      {filteredProjects.length === 0 && !loading && (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 2, bgcolor: '#fafafa', mt: 2 }}>
          <Typography color="text.secondary">Žádné projekty. Vytvořte první projekt!</Typography>
        </Paper>
      )}
    </Box>
  );

  // ======== POD-ÚKOL ROW ========
  const renderPodUkol = (sub: Task) => (
    <Box key={sub.id} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.75, px: 1, mb: 0.5, bgcolor: '#fff', borderRadius: 1.5, border: '1px solid #f0f0f0' }}>
      <SubdirectoryArrowRight fontSize="small" sx={{ color: 'text.disabled', flexShrink: 0 }} />
      <Checkbox size="small" sx={{ p: 0.25 }} checked={sub.status === 'done'}
        onChange={() => {
          if (sub.status === 'done') quickStatus(sub.id, taskPrevStatus[sub.id] || 'todo');
          else { setTaskPrevStatus(p => ({ ...p, [sub.id]: sub.status })); quickStatus(sub.id, 'done'); }
        }} />
      <Typography variant="body2" sx={{ flex: 1, textDecoration: sub.status === 'done' ? 'line-through' : 'none', color: sub.status === 'done' ? 'text.disabled' : 'inherit' }}>
        {sub.title}
      </Typography>
      <Stack direction="row" spacing={0.5} alignItems="center">
        {sChip(sub.status, TASK_CFG)} {pChip(sub.priority)}
        <IconButton size="small" onClick={() => openTaskDialog(sub)}><Edit fontSize="small" /></IconButton>
        <IconButton size="small" color="error" onClick={() => { setDeleteTarget({ type: 'task', id: sub.id }); setDeleteConfirmOpen(true); }}><Delete fontSize="small" /></IconButton>
      </Stack>
    </Box>
  );

  // ======== ÚKOL ROW ========
  const renderUkolRow = (task: Task) => {
    const subs = task.subtasks || [];
    const isExp = expandedUkoly.has(task.id);
    const doneCount = subs.filter(s => s.status === 'done').length;
    const tc = TASK_CFG[task.status] || TASK_CFG.backlog;
    return (
      <Box key={task.id} sx={{ mb: 1 }}>
        <Paper sx={{ p: 1.5, display: 'flex', alignItems: 'flex-start', gap: 1, borderRadius: 2, borderLeft: '4px solid ' + tc.color, ...(subs.length > 0 && isExp ? { borderBottomLeftRadius: 0, borderBottomRightRadius: 0 } : {}) }}>
          <Box sx={{ mt: 0.25, flexShrink: 0 }}>
            {subs.length > 0 ? (
              <IconButton size="small" sx={{ p: 0.25 }} onClick={() => toggleUkol(task.id)}>
                {isExp ? <ExpandMore /> : <ChevronRight />}
              </IconButton>
            ) : (
              <Checkbox size="small" sx={{ p: 0.25 }} checked={task.status === 'done'}
                onChange={() => {
                  if (task.status === 'done') quickStatus(task.id, taskPrevStatus[task.id] || 'todo');
                  else { setTaskPrevStatus(p => ({ ...p, [task.id]: task.status })); quickStatus(task.id, 'done'); }
                }} />
            )}
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle2" fontWeight={700} sx={{ textDecoration: task.status === 'done' ? 'line-through' : 'none' }}>{task.title}</Typography>
            {task.description && (
              <Typography variant="caption" color="text.secondary" sx={{ display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{task.description}</Typography>
            )}
          </Box>
          <Stack direction="row" spacing={0.5} alignItems="center" flexShrink={0}>
            {subs.length > 0 && <Chip label={doneCount + '/' + subs.length} size="small" variant="outlined" sx={{ fontSize: '0.68rem' }} />}
            {sChip(task.status, TASK_CFG)} {pChip(task.priority)}
            {(task.comments?.length || 0) > 0 && (
              <Badge badgeContent={task.comments?.length} color="primary"><Comment fontSize="small" color="action" /></Badge>
            )}
            <Tooltip title="Přidat pod-úkol">
              <IconButton size="small" onClick={() => openTaskDialog(null, task.id)}><Add fontSize="small" /></IconButton>
            </Tooltip>
            <IconButton size="small" onClick={() => openTaskDialog(task)}><Edit fontSize="small" /></IconButton>
            <IconButton size="small" color="error" onClick={() => { setDeleteTarget({ type: 'task', id: task.id }); setDeleteConfirmOpen(true); }}><Delete fontSize="small" /></IconButton>
          </Stack>
        </Paper>
        {subs.length > 0 && (
          <Collapse in={isExp}>
            <Box sx={{ ml: 2, px: 1, pb: 1, bgcolor: '#f8f9fa', border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
              {subs.map(s => renderPodUkol(s))}
              <Box sx={{ mt: 0.5, pl: 4 }}>
                <Button size="small" startIcon={<Add fontSize="small" />} onClick={() => openTaskDialog(null, task.id)} sx={{ fontSize: '0.78rem' }}>
                  Přidat pod-úkol
                </Button>
              </Box>
            </Box>
          </Collapse>
        )}
      </Box>
    );
  };

  // ======== KANBAN ========
  const renderKanban = (tasks: Task[]) => (
    <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
      {TASK_STATUSES.map(status => {
        const cfg = TASK_CFG[status];
        const colTasks = tasks.filter(t => t.status === status);
        return (
          <Paper key={status} sx={{ minWidth: 240, flex: '0 0 240px', borderRadius: 2, bgcolor: dragOverCol === status ? '#e8f5e9' : '#f5f5f5' }}
            onDragOver={e => { e.preventDefault(); setDragOverCol(status); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => { e.preventDefault(); if (draggedTaskId) quickStatus(draggedTaskId, status); setDragOverCol(null); }}>
            <Box sx={{ p: 1.5, borderBottom: '3px solid ' + cfg.color }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label} ({colTasks.length})</Typography>
            </Box>
            <Box sx={{ p: 1, minHeight: 120 }}>
              {colTasks.map(t => {
                const subs = t.subtasks || [];
                return (
                  <Card key={t.id} draggable
                    onDragStart={e => { setDraggedTaskId(t.id); e.dataTransfer.effectAllowed = 'move'; }}
                    onDragEnd={() => { setDraggedTaskId(null); setDragOverCol(null); }}
                    onClick={() => openTaskDialog(t)}
                    sx={{ mb: 1, cursor: 'grab', borderRadius: 1.5, borderLeft: '3px solid ' + (PRI_CFG[t.priority] || PRI_CFG.medium).color, opacity: draggedTaskId === t.id ? 0.4 : 1, '&:hover': { boxShadow: 3 } }}>
                    <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                      <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{t.title}</Typography>
                      <Stack direction="row" spacing={0.5}>
                        {pChip(t.priority)}
                        {subs.length > 0 && <Chip label={subs.filter(s => s.status === 'done').length + '/' + subs.length + ' pod.'} size="small" variant="outlined" sx={{ fontSize: '0.62rem' }} />}
                      </Stack>
                    </CardContent>
                  </Card>
                );
              })}
            </Box>
          </Paper>
        );
      })}
    </Box>
  );

  // ======== SWIMLANE ========
  const renderSwimlane = (tasks: Task[]) => (
    <Box>
      {TASK_STATUSES.map(status => {
        const cfg = TASK_CFG[status];
        const rowTasks = tasks.filter(t => t.status === status);
        return (
          <Box key={status} sx={{ display: 'flex', mb: 1.5, borderRadius: 2, overflow: 'hidden' }}
            onDragOver={e => { e.preventDefault(); setDragOverCol(status); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => { e.preventDefault(); if (draggedTaskId) quickStatus(draggedTaskId, status); setDragOverCol(null); }}>
            <Box sx={{ minWidth: 130, p: 1.5, bgcolor: cfg.bg, display: 'flex', alignItems: 'center', borderLeft: '3px solid ' + cfg.color }}>
              <Typography variant="caption" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label} ({rowTasks.length})</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1, p: 1, flex: 1, overflowX: 'auto', minHeight: 60, bgcolor: dragOverCol === status ? '#e8f5e960' : 'transparent' }}>
              {rowTasks.map(t => (
                <Card key={t.id} draggable
                  onDragStart={e => { setDraggedTaskId(t.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={() => { setDraggedTaskId(null); setDragOverCol(null); }}
                  onClick={() => openTaskDialog(t)}
                  sx={{ minWidth: 180, cursor: 'grab', borderRadius: 1.5, flexShrink: 0, opacity: draggedTaskId === t.id ? 0.4 : 1, '&:hover': { boxShadow: 2 } }}>
                  <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                    <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{t.title}</Typography>
                    {pChip(t.priority)}
                  </CardContent>
                </Card>
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );

  // ======== PROJECT PAGE ========
  const renderProjectPage = () => {
    if (!selectedProject) return null;
    const sp = selectedProject;
    const sc = STATUS_CFG[sp.status] || STATUS_CFG.backlog;
    const topTasks = (sp.tasks || []).filter(t => !t.parent_task_id);
    const allTasks = sp.tasks || [];
    const doneAll = allTasks.filter(t => t.status === 'done').length;
    return (
      <Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Button startIcon={<ArrowBack />} onClick={goBack} sx={{ color: COLORS.emerald, fontWeight: 600 }}>
            Všechny projekty
          </Button>
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" size="small" startIcon={<Edit />}
              onClick={() => { setEditingProject({ ...sp, label_ids: sp.labels?.map(l => l.id) || [] }); setProjectDialogOpen(true); }}>
              Upravit projekt
            </Button>
            <Button variant="outlined" size="small" color="error" startIcon={<Delete />}
              onClick={() => { setDeleteTarget({ type: 'project', id: sp.id }); setDeleteConfirmOpen(true); }}>
              Smazat
            </Button>
          </Stack>
        </Box>

        <Paper sx={{ p: 3, mb: 3, borderRadius: 3, background: 'linear-gradient(135deg, ' + COLORS.darkForest + ' 0%, ' + COLORS.emerald + ' 100%)', color: '#fff' }}>
          <Typography variant="h4" fontWeight={800} sx={{ mb: sp.description ? 0.5 : 0 }}>{sp.name}</Typography>
          {sp.description && <Typography variant="body1" sx={{ opacity: 0.9, mb: 2, maxWidth: 720 }}>{sp.description}</Typography>}
          <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center" useFlexGap>
            <Chip label={sc.label} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff', fontWeight: 700 }} />
            <Chip label={(PRI_CFG[sp.priority] || PRI_CFG.medium).label} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} />
            <Chip label={topTasks.length + ' úkolů'} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} />
            {sp.estimated_hours && <Chip label={'Odhad: ' + sp.estimated_hours + 'h'} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} />}
            {sp.location && <Chip icon={<FolderOpen sx={{ color: '#fff !important', fontSize: 14 }} />} label={sp.location} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.2)', color: '#fff' }} />}
            {sp.docs_repo && <Chip icon={<MenuBook sx={{ color: '#fff !important', fontSize: 14 }} />} label="Dokumentace" size="small" sx={{ bgcolor: 'rgba(255,255,255,0.25)', color: '#fff', fontWeight: 600 }} />}
          </Stack>
          {sp.labels?.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ mt: 1.5 }} flexWrap="wrap">
              {sp.labels.map(l => <Chip key={l.id} label={l.name} size="small" sx={{ bgcolor: l.color + '55', color: '#fff', fontSize: '0.7rem' }} />)}
            </Stack>
          )}
          {allTasks.length > 0 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2 }}>
              <LinearProgress variant="determinate" value={sp.progress_percent}
                sx={{ flex: 1, maxWidth: 400, height: 8, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.3)', '& .MuiLinearProgress-bar': { bgcolor: '#fff' } }} />
              <Typography variant="body2" fontWeight={700}>{sp.progress_percent}% ({doneAll}/{allTasks.length})</Typography>
            </Box>
          )}
        </Paper>

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5" fontWeight={700} sx={{ color: COLORS.darkForest }}>Úkoly</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <ToggleButtonGroup size="small" exclusive value={taskViewMode} onChange={(_, v) => v && setTaskViewMode(v)}>
              <ToggleButton value="list"><ViewList fontSize="small" /></ToggleButton>
              <ToggleButton value="kanban"><ViewModule fontSize="small" /></ToggleButton>
              <ToggleButton value="swimlane"><ViewStream fontSize="small" /></ToggleButton>
            </ToggleButtonGroup>
            <Button variant="contained" startIcon={<Add />} size="small" onClick={() => openTaskDialog(null, null)}>
              Nový úkol
            </Button>
          </Stack>
        </Box>

        {taskViewMode === 'list' && (
          topTasks.length === 0
            ? <Paper sx={{ p: 3, textAlign: 'center', borderRadius: 2, bgcolor: '#fafafa' }}><Typography color="text.secondary">Žádné úkoly. Přidejte první úkol!</Typography></Paper>
            : topTasks.map(t => renderUkolRow(t))
        )}
        {taskViewMode === 'kanban' && renderKanban(topTasks)}
        {taskViewMode === 'swimlane' && renderSwimlane(topTasks)}
      </Box>
    );
  };

  // ======== TASK DIALOG ========
  const isEdit = !!(editingTask?.id);
  const dialogTitle = isEdit ? 'Upravit' : (parentForNewTask ? 'Nový pod-úkol' : 'Nový úkol');

  // ======== MAIN RENDER ========
  if (loading) return <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}><CircularProgress /></Box>;

  return (
    <Box sx={{ px: 3, py: 2, maxWidth: 1600, mx: 'auto' }}>
      {view === 'overview' ? renderOverview() : renderProjectPage()}

      {/* Project dialog */}
      <Dialog open={projectDialogOpen} onClose={() => setProjectDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingProject?.id ? 'Upravit projekt' : 'Nový projekt'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Název" required fullWidth value={editingProject?.name || ''} onChange={e => setEditingProject(p => p ? { ...p, name: e.target.value } : p)} />
            <TextField label="Popis" multiline rows={3} fullWidth value={editingProject?.description || ''} onChange={e => setEditingProject(p => p ? { ...p, description: e.target.value } : p)} />
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Stav</InputLabel>
                <Select value={editingProject?.status || 'backlog'} label="Stav" onChange={e => setEditingProject(p => p ? { ...p, status: e.target.value } : p)}>
                  {PROJ_STATUSES.map(s => <MenuItem key={s} value={s}>{STATUS_CFG[s]?.label || s}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Priorita</InputLabel>
                <Select value={editingProject?.priority || 'medium'} label="Priorita" onChange={e => setEditingProject(p => p ? { ...p, priority: e.target.value } : p)}>
                  {Object.entries(PRI_CFG).map(([v, c]) => <MenuItem key={v} value={v}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
            <TextField label="Umístění" fullWidth value={editingProject?.location || ''} onChange={e => setEditingProject(p => p ? { ...p, location: e.target.value } : p)} />
            <TextField label="Docs repo" fullWidth value={editingProject?.docs_repo || ''}
              onChange={e => setEditingProject(p => p ? { ...p, docs_repo: e.target.value || null } : p)}
              helperText="Název složky v /docs/ pro dokumentaci projektu" />
            <Stack direction="row" spacing={2}>
              <TextField label="Odhad hodin" type="number" fullWidth value={editingProject?.estimated_hours ?? ''} onChange={e => setEditingProject(p => p ? { ...p, estimated_hours: e.target.value ? parseFloat(e.target.value) : null } : p)} />
              <TextField label="Cílový termín" type="date" fullWidth InputLabelProps={{ shrink: true }} value={editingProject?.target_date || ''} onChange={e => setEditingProject(p => p ? { ...p, target_date: e.target.value || null } : p)} />
            </Stack>
            {allLabels.length > 0 && (
              <FormControl fullWidth size="small">
                <InputLabel>Štítky</InputLabel>
                <Select multiple value={(editingProject as any)?.label_ids || []}
                  onChange={e => setEditingProject(p => p ? { ...p, label_ids: e.target.value as number[] } : p)}
                  input={<OutlinedInput label="Štítky" />}
                  renderValue={sel => (
                    <Stack direction="row" spacing={0.5} flexWrap="wrap">
                      {(sel as number[]).map(id => { const l = allLabels.find(x => x.id === id); return l ? <Chip key={id} label={l.name} size="small" sx={{ bgcolor: l.color + '22', color: l.color }} /> : null; })}
                    </Stack>
                  )}>
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
          <Button onClick={() => setProjectDialogOpen(false)}>Zrušit</Button>
          <Button variant="contained" onClick={handleSaveProject}>{editingProject?.id ? 'Uložit' : 'Vytvořit'}</Button>
        </DialogActions>
      </Dialog>

      {/* Task dialog */}
      <Dialog open={taskDialogOpen} onClose={() => { setTaskDialogOpen(false); setParentForNewTask(null); }} maxWidth="md" fullWidth>
        <DialogTitle>{dialogTitle}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField label="Název" required fullWidth value={editingTask?.title || ''} onChange={e => setEditingTask(p => p ? { ...p, title: e.target.value } : p)} />
            <TextField label="Popis" multiline minRows={4} maxRows={16} fullWidth value={editingTask?.description || ''}
              onChange={e => setEditingTask(p => p ? { ...p, description: e.target.value } : p)}
              InputProps={{ sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }} />
            <Stack direction="row" spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel>Stav</InputLabel>
                <Select value={editingTask?.status || 'backlog'} label="Stav" onChange={e => setEditingTask(p => p ? { ...p, status: e.target.value } : p)}>
                  {TASK_STATUSES.map(s => <MenuItem key={s} value={s}>{TASK_CFG[s]?.label || s}</MenuItem>)}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel>Priorita</InputLabel>
                <Select value={editingTask?.priority || 'medium'} label="Priorita" onChange={e => setEditingTask(p => p ? { ...p, priority: e.target.value } : p)}>
                  {Object.entries(PRI_CFG).map(([v, c]) => <MenuItem key={v} value={v}>{c.label}</MenuItem>)}
                </Select>
              </FormControl>
            </Stack>
            <Stack direction="row" spacing={2}>
              <TextField label="Odhad hodin" type="number" fullWidth value={editingTask?.estimated_hours ?? ''}
                onChange={e => setEditingTask(p => p ? { ...p, estimated_hours: e.target.value ? parseFloat(e.target.value) : null } : p)} />
              <TextField label="Termín" type="date" fullWidth InputLabelProps={{ shrink: true }} value={editingTask?.due_date || ''}
                onChange={e => setEditingTask(p => p ? { ...p, due_date: e.target.value || null } : p)} />
            </Stack>

            {editingTask?.id && (
              <>
                <Divider sx={{ my: 1 }} />
                <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Comment fontSize="small" /> Komentáře ({editingTask.comments?.length || 0})
                </Typography>
                <Box sx={{ maxHeight: 180, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 1 }}>
                  {(editingTask.comments || []).map((c: any) => (
                    <Box key={c.id} sx={{ mb: 1, p: 1, bgcolor: '#fff', borderRadius: 1 }}>
                      <Typography variant="caption" fontWeight={600}>{c.author}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{c.created_at ? new Date(c.created_at).toLocaleString('cs-CZ') : ''}</Typography>
                      <Typography variant="body2">{c.content}</Typography>
                    </Box>
                  ))}
                </Box>
                <Stack direction="row" spacing={1}>
                  <TextField size="small" fullWidth placeholder="Přidat komentář..." value={commentText}
                    onChange={e => setCommentText(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && editingTask?.id) { e.preventDefault(); handleAddComment(editingTask.id); } }} />
                  <Button variant="contained" size="small" onClick={() => editingTask?.id && handleAddComment(editingTask.id)}>Odeslat</Button>
                </Stack>

                <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 1 }}>
                  <StickyNote2 fontSize="small" /> Poznámky ({editingTask.notes?.length || 0})
                </Typography>
                <Box sx={{ maxHeight: 180, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 1 }}>
                  {(editingTask.notes || []).map((n: TaskNote) => {
                    const bc: Record<string, string> = { bug: '#c62828', note: '#1565c0', idea: '#ff9800' };
                    const ic: Record<string, ReactElement> = { bug: <BugReport fontSize="small" />, note: <NoteAlt fontSize="small" />, idea: <Lightbulb fontSize="small" /> };
                    return (
                      <Box key={n.id} sx={{ mb: 1, p: 1, bgcolor: '#fff', borderRadius: 1, borderLeft: '3px solid ' + (bc[n.note_type] || '#999') }}>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          {ic[n.note_type]} <Typography variant="caption" fontWeight={600}>{n.author}</Typography>
                          <Typography variant="caption" color="text.secondary">{n.created_at ? new Date(n.created_at).toLocaleString('cs-CZ') : ''}</Typography>
                        </Stack>
                        <Typography variant="body2" sx={{ textDecoration: n.resolved ? 'line-through' : 'none', opacity: n.resolved ? 0.5 : 1 }}>{n.content}</Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                          {n.note_type === 'bug' && <FormControlLabel control={<Checkbox size="small" checked={n.resolved} onChange={() => handleToggleNote(n.id)} />} label={<Typography variant="caption">Vyřešeno</Typography>} />}
                          {n.note_type === 'idea' && !n.promoted_task_id && <Button size="small" startIcon={<Rocket fontSize="small" />} onClick={() => handlePromote(n.id)}>Povýšit na úkol</Button>}
                          {n.promoted_task_id && <Chip label={'Povýšeno → úkol #' + n.promoted_task_id} size="small" color="success" variant="outlined" icon={<CheckCircle fontSize="small" />} />}
                        </Stack>
                      </Box>
                    );
                  })}
                </Box>
                <Stack direction="row" spacing={1}>
                  <FormControl size="small" sx={{ minWidth: 130 }}>
                    <Select value={noteType} onChange={e => setNoteType(e.target.value as any)}>
                      <MenuItem value="note">Poznámka</MenuItem>
                      <MenuItem value="bug">Bug</MenuItem>
                      <MenuItem value="idea">Nápad</MenuItem>
                    </Select>
                  </FormControl>
                  <TextField size="small" fullWidth placeholder="Přidat poznámku..." value={noteText} onChange={e => setNoteText(e.target.value)} />
                  <Button variant="contained" size="small" onClick={() => editingTask?.id && handleAddNote(editingTask.id)}>Přidat</Button>
                </Stack>

                <FormControlLabel control={<Switch size="small" checked={showAudit} onChange={() => setShowAudit(!showAudit)} />}
                  label={<Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><History fontSize="small" /> Historie změn</Typography>}
                  sx={{ mt: 1 }} />
                {showAudit && (
                  <Box sx={{ maxHeight: 180, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 1 }}>
                    {(editingTask.audit_logs || []).sort((a: TaskAudit, b: TaskAudit) => new Date(b.changed_at || 0).getTime() - new Date(a.changed_at || 0).getTime()).map((a: TaskAudit) => (
                      <Box key={a.id} sx={{ mb: 0.5, p: 1, bgcolor: '#fff', borderRadius: 1, display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                        <Typography variant="caption" fontWeight={600}>{a.changed_by}</Typography>
                        <Chip label={a.field} size="small" variant="outlined" sx={{ fontSize: '0.62rem' }} />
                        {a.old_value && <Chip label={a.old_value} size="small" sx={{ bgcolor: '#ffebee', color: '#c62828', textDecoration: 'line-through', fontSize: '0.62rem' }} />}
                        <ArrowForward sx={{ fontSize: 14, color: 'text.secondary' }} />
                        <Chip label={a.new_value || '(prázdné)'} size="small" sx={{ bgcolor: '#e8f5e9', color: '#2e7d32', fontSize: '0.62rem' }} />
                        <Typography variant="caption" color="text.secondary">{a.changed_at ? new Date(a.changed_at).toLocaleString('cs-CZ') : ''}</Typography>
                      </Box>
                    ))}
                    {(!editingTask.audit_logs || editingTask.audit_logs.length === 0) && <Typography variant="caption" color="text.secondary">Žádné změny.</Typography>}
                  </Box>
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setTaskDialogOpen(false); setParentForNewTask(null); }}>Zrušit</Button>
          <Button variant="contained" onClick={handleSaveTask}>{editingTask?.id ? 'Uložit' : 'Vytvořit'}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle>Potvrdit smazání</DialogTitle>
        <DialogContent><Typography>Opravdu chcete smazat tento {deleteTarget?.type === 'project' ? 'projekt' : 'úkol'}? Tato akce je nevratná.</Typography></DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Zrušit</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Smazat</Button>
        </DialogActions>
      </Dialog>

      {/* Labels dialog */}
      <Dialog open={labelsDialogOpen} onClose={() => setLabelsDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Správa štítků</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Stack direction="row" spacing={1}>
              <TextField size="small" label="Název štítku" value={editingLabel.name} onChange={e => setEditingLabel(p => ({ ...p, name: e.target.value }))} sx={{ flex: 1 }} />
              <TextField size="small" label="Barva" type="color" value={editingLabel.color} onChange={e => setEditingLabel(p => ({ ...p, color: e.target.value }))} sx={{ width: 80 }} />
              <Button variant="contained" size="small" onClick={handleSaveLabel}>Přidat</Button>
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
        <DialogActions><Button onClick={() => setLabelsDialogOpen(false)}>Zavřít</Button></DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(p => ({ ...p, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar(p => ({ ...p, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
