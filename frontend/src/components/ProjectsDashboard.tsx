import { useState, useEffect, useCallback } from 'react';
import type { ReactElement } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Box, Typography, Card, CardContent, Chip, Button, IconButton,
  Dialog, DialogTitle, DialogContent, DialogActions, TextField,
  Select, MenuItem, FormControl, InputLabel, LinearProgress,
  Paper, Stack, CircularProgress, Snackbar, Alert, Badge,
  Checkbox, OutlinedInput, ListItemText, Collapse,
  ToggleButton, ToggleButtonGroup, Divider, Switch, FormControlLabel, Tooltip,
} from '@mui/material';
// Grid import removed - using row-based layout
import {
  Add, Edit, Delete, ContentCopy, FolderOpen, ArrowBack,
  Schedule, Science, ViewModule, ViewList, ViewStream,
  FilterList, PriorityHigh, Flag, PlayArrow, Done, Block,
  ExpandMore, ChevronRight, SubdirectoryArrowRight,
  BugReport, Lightbulb, NoteAlt, CheckCircle,
  Rocket, History, StickyNote2, Comment, ArrowForward, MenuBook,
  VisibilityOff, Visibility, WarningAmber, InfoOutlined,
} from '@mui/icons-material';
import projectsApi from '../api/projects';
import { docsApi } from '../api/projects';
import type { Project, Task, ProjectDetail, Label, TaskNote, TaskAudit, DocFile, PhasesData, PhaseInfo } from '../api/projects';

const COLORS = { darkForest: '#00472e', emerald: '#007638' };

const STATUS_CFG: Record<string, { label: string; color: string; bg: string; icon?: ReactElement }> = {
  backlog:     { label: 'Nápad',      color: '#9c27b0', bg: '#f3e5f5', icon: <Schedule fontSize="small" /> },
  planning:    { label: 'Plánování', color: '#1565c0', bg: '#e3f2fd' },
  in_progress: { label: 'Probíhá', color: COLORS.emerald, bg: '#e8f5e9', icon: <PlayArrow fontSize="small" /> },
  testing:     { label: 'Testování', color: '#e65100', bg: '#fff3e0', icon: <Science fontSize="small" /> },
  done:        { label: 'Hotovo',     color: '#2e7d32', bg: '#c8e6c9', icon: <Done fontSize="small" /> },
  archived:    { label: 'Pozastaveno', color: '#c62828', bg: '#ffebee', icon: <Block fontSize="small" /> },
};

const TASK_CFG: Record<string, { label: string; color: string; bg: string }> = {
  backlog:     { label: 'Nápad',      color: '#9c27b0', bg: '#f3e5f5' },
  todo:        { label: 'Plánováno', color: '#1565c0', bg: '#e3f2fd' },
  in_progress: { label: 'Probíhá', color: COLORS.emerald, bg: '#e8f5e9' },
  testing:     { label: 'Testování', color: '#e65100', bg: '#fff3e0' },
  done:        { label: 'Hotovo',     color: '#2e7d32', bg: '#c8e6c9' },
  blocked:     { label: 'Blokováno', color: '#c62828', bg: '#ffebee' },
};

const PRI_CFG: Record<string, { label: string; color: string; icon?: ReactElement }> = {
  low:      { label: 'Nízká', color: '#66bb6a' },
  medium:   { label: 'Střední', color: '#ffa726' },
  high:     { label: 'Vysoká', color: '#ef5350', icon: <PriorityHigh fontSize="small" /> },
  critical: { label: 'Kritická', color: '#c62828', icon: <Flag fontSize="small" /> },
};

const TASK_STATUSES = ['backlog', 'todo', 'in_progress', 'testing', 'done', 'blocked'];
const PROJ_STATUSES = ['backlog', 'planning', 'in_progress', 'testing', 'done', 'archived'];
const PROJ_PRIORITIES = ['critical', 'high', 'medium', 'low'];

export default function ProjectsDashboard() {
  const [view, setView] = useState<'overview' | 'project'>('overview');
  const [projects, setProjects] = useState<Project[]>([]);
  const [allLabels, setAllLabels] = useState<Label[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({ open: false, message: '', severity: 'success' });
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'status' | 'priority' | 'name' | 'progress'>('status');
  const [filterStatus, setFilterStatus] = useState<Set<string>>(new Set());
  const [filterPriority, setFilterPriority] = useState<string>('all');
  const [filterLabels, setFilterLabels] = useState<Set<number>>(new Set());
  const [taskViewMode, setTaskViewMode] = useState<'list' | 'kanban' | 'swimlane'>('swimlane');
  const [expandedUkoly, setExpandedUkoly] = useState<Set<number>>(new Set());
  const [draggedTaskId, setDraggedTaskId] = useState<number | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<number | null>(null);
  const [projDragOverLane, setProjDragOverLane] = useState<string | null>(null);
  const [dragInsertInfo, setDragInsertInfo] = useState<{ taskId: number; pos: 'before' | 'after' } | null>(null);
  const [taskPrevStatus, setTaskPrevStatus] = useState<Record<number, string>>({});
  const [hideDone, setHideDone] = useState(false);
  const [inlineTaskText, setInlineTaskText] = useState<Record<string, string>>({});
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [editingProject, setEditingProject] = useState<Partial<Project> & { label_ids?: number[] } | null>(null);
  const [taskDialogOpen, setTaskDialogOpen] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [copySubtasks, setCopySubtasks] = useState(false);
  const [duplicateSourceSubtasks, setDuplicateSourceSubtasks] = useState<Task[]>([]);
  const [editingTask, setEditingTask] = useState<Partial<Task> | null>(null);
  const [parentForNewTask, setParentForNewTask] = useState<number | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'project' | 'task'; id: number } | null>(null);
  const [labelsDialogOpen, setLabelsDialogOpen] = useState(false);
  const [previewTask, setPreviewTask] = useState<Task | null>(null);
  const [editingLabel, setEditingLabel] = useState<{ name: string; color: string; description: string }>({ name: '', color: '#4caf50', description: '' });
  const [commentText, setCommentText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [noteType, setNoteType] = useState<'bug' | 'note' | 'idea'>('note');
  const [showAudit, setShowAudit] = useState(false);
  const [docDetailTask, setDocDetailTask] = useState<Task | null>(null);
  const [docContent, setDocContent] = useState<string | null>(null);
  const [docPath, setDocPath] = useState<string | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  const [docFiles, setDocFiles] = useState<Record<string, DocFile[]>>({});
  const [phasesData, setPhasesData] = useState<PhasesData | null>(null);

  const findDocFile = async (task: Task, parentTitle: string): Promise<string | null> => {
    if (!selectedProject?.docs_repo) return null;
    const repo = selectedProject.docs_repo;

    // First, find the correct folder by fuzzy-matching parentTitle to actual folder names
    const rootCacheKey = repo + '/__root__';
    let rootFiles = docFiles[rootCacheKey];
    if (!rootFiles) {
      try {
        rootFiles = await docsApi.listFiles(repo);
        setDocFiles(prev => ({ ...prev, [rootCacheKey]: rootFiles! }));
      } catch { return null; }
    }

    // Match parent title to folder: case-insensitive, partial match
    const ptLower = parentTitle.toLowerCase();
    const folder = rootFiles.find(f => f.is_dir && f.name.toLowerCase() === ptLower)
      || rootFiles.find(f => f.is_dir && f.name.toLowerCase().includes(ptLower))
      || rootFiles.find(f => f.is_dir && ptLower.includes(f.name.toLowerCase()))
      || rootFiles.find(f => f.is_dir && ptLower.split(' ').filter(w => w.length > 2).every(w => f.name.toLowerCase().includes(w)));
    if (!folder) return null;
    const folderPath = folder.path;

    // Now list files in the matched folder  
    const cacheKey = repo + '/' + folderPath;
    let files = docFiles[cacheKey];
    if (!files) {
      try {
        files = await docsApi.listFiles(repo, folderPath);
        setDocFiles(prev => ({ ...prev, [cacheKey]: files! }));
      } catch { return null; }
    }

    // Match sub-task title to a .md file
    const titleLower = task.title.toLowerCase();
    const match = files.find(f => !f.is_dir && titleLower.includes(f.name.replace(/\.md$/, '').toLowerCase()));
    if (match) return folderPath + '/' + match.name;
    const fuzzy = files.find(f => !f.is_dir && f.name.replace(/\.md$/, '').toLowerCase().split(' ').some(w => w.length > 3 && titleLower.includes(w)));
    return fuzzy ? folderPath + '/' + fuzzy.name : null;
  };

  const openDocDetail = async (task: Task, parentTitle: string) => {
    setDocDetailTask(task);
    setDocContent(null);
    setDocPath(null);
    setDocLoading(true);
    try {
      const path = await findDocFile(task, parentTitle);
      if (path && selectedProject?.docs_repo) {
        const doc = await docsApi.readFile(selectedProject.docs_repo, path);
        setDocContent(doc.content);
        setDocPath(path);
      } else {
        setDocContent(null);
      }
    } catch { setDocContent(null); }
    setDocLoading(false);
  };

  const toggleDocCheckbox = async (lineIndex: number) => {
    if (!docContent || !docPath || !selectedProject?.docs_repo) return;
    const lines = docContent.split('\n');
    const line = lines[lineIndex];
    if (!line) return;
    if (line.includes('- [ ] ')) {
      lines[lineIndex] = line.replace('- [ ] ', '- [x] ');
    } else if (line.includes('- [x] ')) {
      lines[lineIndex] = line.replace('- [x] ', '- [ ] ');
    } else return;
    const newContent = lines.join('\n');
    setDocContent(newContent);
    try {
      await docsApi.writeFile(selectedProject.docs_repo, docPath, newContent);
    } catch { showSnack('Nepoda\u0159ilo se ulo\u017eit zm\u011bnu', 'error'); }
  };

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

  // Load phases whenever selectedProject changes and has docs_repo
  useEffect(() => {
    if (selectedProject?.docs_repo) {
      docsApi.getPhases(selectedProject.docs_repo, selectedProject.id)
        .then(data => setPhasesData(data))
        .catch(() => setPhasesData(null));
    } else {
      setPhasesData(null);
    }
  }, [selectedProject]);

  // Phase helpers
  const getTaskPhase = (taskId: number): PhaseInfo | null => {
    if (!phasesData) return null;
    return phasesData.phases.find(p => p.task_ids.includes(taskId)) || null;
  };

  const isTaskInActivePhase = (taskId: number): boolean => {
    if (!phasesData) return true; // No phases = no restrictions
    const phase = getTaskPhase(taskId);
    if (!phase) return true; // Unassigned tasks are unrestricted
    return phase.number <= phasesData.current_phase;
  };

  const ACTIVE_STATUSES = ['in_progress', 'testing', 'done'];

  const setCurrentPhase = async (phase: number) => {
    if (!selectedProject) return;
    try {
      await projectsApi.update(selectedProject.id, { current_phase: phase } as any);
      setPhasesData(prev => prev ? { ...prev, current_phase: phase } : prev);
      setSelectedProject(prev => prev ? { ...prev, current_phase: phase } : prev);
      showSnack(`Aktuální fáze nastavena na ${phase}`);
    } catch { showSnack('Nepodařilo se změnit fázi', 'error'); }
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
        const created = await projectsApi.createTask(selectedProject.id, { ...editingTask, parent_task_id: parentForNewTask });
        if (isDuplicating && copySubtasks && duplicateSourceSubtasks.length > 0) {
          for (const sub of duplicateSourceSubtasks) {
            await projectsApi.createTask(selectedProject.id, {
              title: sub.title, description: sub.description, status: sub.status,
              priority: sub.priority, task_type: sub.task_type,
              estimated_hours: sub.estimated_hours, due_date: sub.due_date,
              parent_task_id: created.id,
            });
          }
          showSnack(`Duplikováno včetně ${duplicateSourceSubtasks.length} pod-úkolů`);
        } else {
          showSnack(parentForNewTask ? 'Pod-úkol přidán' : 'Úkol přidán');
        }
      }
      setTaskDialogOpen(false); setEditingTask(null); setParentForNewTask(null);
      setIsDuplicating(false); setCopySubtasks(false); setDuplicateSourceSubtasks([]);
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

  const getDeleteInfo = () => {
    if (!deleteTarget) return null;
    if (deleteTarget.type === 'project') {
      const p = projects.find(x => x.id === deleteTarget.id) || selectedProject;
      const taskCount = p?.task_count || (selectedProject?.id === deleteTarget.id ? (selectedProject.tasks || []).length : 0);
      return { label: p?.name || 'projekt', details: taskCount > 0 ? `Včetně ${taskCount} úkolů se všemi pod-úkoly, komentáři a poznámkami.` : null };
    } else {
      const allTasks = selectedProject?.tasks || [];
      const task = allTasks.find(t => t.id === deleteTarget.id) || allTasks.flatMap(t => t.subtasks || []).find(t => t.id === deleteTarget.id);
      if (!task) return { label: 'úkol', details: null };
      const parts: string[] = [];
      if ((task.subtasks?.length || 0) > 0) parts.push(`${task.subtasks!.length} pod-úkolů`);
      if ((task.comments?.length || 0) > 0) parts.push(`${task.comments!.length} komentářů`);
      if ((task.notes?.length || 0) > 0) parts.push(`${task.notes!.length} poznámek`);
      return { label: task.title, details: parts.length > 0 ? `Smaže se i: ${parts.join(', ')}.` : null };
    }
  };

  const resetDragState = () => {
    setDraggedTaskId(null);
    setDragInsertInfo(null);
    setDragOverCol(null);
  };

  const handleCardDragOver = (e: React.DragEvent, taskId: number, isHorizontal = false) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    const pos = isHorizontal
      ? (e.clientX < rect.left + rect.width / 2 ? 'before' : 'after')
      : (e.clientY < rect.top + rect.height / 2 ? 'before' : 'after');
    setDragInsertInfo({ taskId, pos });
  };

  const handleCardDrop = async (e: React.DragEvent, targetTaskId: number, targetStatus: string, columnTasks: Task[]) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedTaskId || draggedTaskId === targetTaskId || !selectedProject) { resetDragState(); return; }
    const allT = (selectedProject.tasks || []).flatMap(t => [t, ...(t.subtasks || [])]);
    const draggedTask = allT.find(t => t.id === draggedTaskId);
    if (!draggedTask) { resetDragState(); return; }
    if (draggedTask.status === targetStatus) {
      const colTasks = [...columnTasks.filter(t => t.status === targetStatus)].sort((a, b) => a.sort_order - b.sort_order);
      const filtered = colTasks.filter(t => t.id !== draggedTaskId);
      const targetIdx = filtered.findIndex(t => t.id === targetTaskId);
      const insertIdx = dragInsertInfo?.pos === 'after' ? targetIdx + 1 : targetIdx;
      filtered.splice(Math.max(0, insertIdx), 0, draggedTask);
      try {
        await projectsApi.reorderTasks(filtered.map((t, i) => ({ id: t.id, sort_order: i * 10 })));
        loadProjectDetail(selectedProject.id);
      } catch { showSnack('Chyba při řazení', 'error'); }
    } else {
      if (ACTIVE_STATUSES.includes(targetStatus) && !isTaskInActivePhase(draggedTaskId)) {
        showSnack('Tento úkol není v aktuální fázi — nelze přesunout', 'error');
      } else {
        quickStatus(draggedTaskId, targetStatus);
      }
    }
    resetDragState();
  };

  const handleInlineAdd = async (status: string, parentId?: number) => {
    const key = parentId ? `sub_${parentId}_${status}` : status;
    const title = inlineTaskText[key]?.trim();
    if (!title || !selectedProject) return;
    try {
      await projectsApi.createTask(selectedProject.id, {
        title, status, priority: 'medium', task_type: 'task',
        parent_task_id: parentId || undefined,
      } as Partial<Task>);
      setInlineTaskText(p => ({ ...p, [key]: '' }));
      loadProjectDetail(selectedProject.id);
      showSnack(parentId ? 'Pod-úkol přidán' : 'Úkol přidán');
    } catch { showSnack('Chyba', 'error'); }
  };

  const quickStatus = async (taskId: number, newStatus: string) => {
    // Phase restriction: block active statuses for tasks not in current phase
    if (ACTIVE_STATUSES.includes(newStatus) && !isTaskInActivePhase(taskId)) {
      showSnack('Tento úkol není v aktuální fázi — nelze přesunout do aktivního stavu', 'error');
      return;
    }
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
    setIsDuplicating(false);
    setCommentText(''); setNoteText(''); setShowAudit(false);
    setTaskDialogOpen(true);
  };

  const openDuplicateDialog = (task: Task) => {
    setEditingTask({
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      task_type: task.task_type,
      estimated_hours: task.estimated_hours,
      due_date: task.due_date,
    });
    setParentForNewTask(task.parent_task_id);
    const subs = task.subtasks || [];
    setDuplicateSourceSubtasks(subs);
    setCopySubtasks(subs.length > 0);
    setIsDuplicating(true);
    setCommentText(''); setNoteText(''); setShowAudit(false);
    setTaskDialogOpen(true);
  };

  const toggleFilterLabel = (id: number) => {
    setFilterLabels(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const toggleFilterStatus = (s: string) => {
    setFilterStatus(prev => { const next = new Set(prev); if (next.has(s)) next.delete(s); else next.add(s); return next; });
  };

  const filteredProjects = projects
    .filter(p =>
      (!searchQuery || p.name.toLowerCase().includes(searchQuery.toLowerCase()) || (p.description || '').toLowerCase().includes(searchQuery.toLowerCase()))
      && (filterStatus.size === 0 || filterStatus.has(p.status))
      && (filterPriority === 'all' || p.priority === filterPriority)
      && (filterLabels.size === 0 || [...filterLabels].some(lid => p.labels.some(l => l.id === lid)))
    )
    .sort((a, b) => {
      if (sortBy === 'status') return PROJ_STATUSES.indexOf(a.status) - PROJ_STATUSES.indexOf(b.status);
      if (sortBy === 'priority') { const po = ['critical', 'high', 'medium', 'low']; return po.indexOf(a.priority) - po.indexOf(b.priority); }
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'cs');
      if (sortBy === 'progress') return (b.progress_percent || 0) - (a.progress_percent || 0);
      return 0;
    });

  const handleProjDrop = async (projectId: number, groupBy: 'status' | 'priority', newValue: string) => {
    try {
      await projectsApi.update(projectId, groupBy === 'status' ? { status: newValue } : { priority: newValue });
      loadProjects();
    } catch { showSnack('Nepodařilo se přesunout', 'error'); }
  };

  const renderProjectSwimlane = (groupBy: 'status' | 'priority') => {
    const groups = groupBy === 'status'
      ? PROJ_STATUSES.map(key => ({ key, color: STATUS_CFG[key]?.color || '#999', bg: STATUS_CFG[key]?.bg || '#f5f5f5', label: STATUS_CFG[key]?.label || key }))
      : PROJ_PRIORITIES.map(key => ({ key, color: PRI_CFG[key]?.color || '#999', bg: (PRI_CFG[key]?.color || '#999') + '22', label: PRI_CFG[key]?.label || key }));
    return (
      <Box>
        {groups.map(({ key, color, bg, label }) => {
          const laneProjects = filteredProjects.filter(p => groupBy === 'status' ? p.status === key : p.priority === key);
          const isOver = projDragOverLane === key;
          return (
            <Box key={key} sx={{ mb: 2 }}
              onDragOver={e => { e.preventDefault(); setProjDragOverLane(key); }}
              onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setProjDragOverLane(null); }}
              onDrop={e => { e.preventDefault(); if (draggedProjectId !== null) handleProjDrop(draggedProjectId, groupBy, key); setProjDragOverLane(null); setDraggedProjectId(null); }}>
              {/* Group header */}
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, px: 0.5 }}>
                <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
                <Typography variant="overline" fontWeight={700} sx={{ color, lineHeight: 1, letterSpacing: 1 }}>{label}</Typography>
                <Chip label={laneProjects.length} size="small" sx={{ height: 18, bgcolor: color + '22', color, fontSize: '0.68rem', '& .MuiChip-label': { px: 0.75 } }} />
                <Box sx={{ flex: 1, height: 1, bgcolor: color + '33' }} />
              </Box>
              {/* Project rows — same style as flat list */}
              <Stack spacing={1} sx={{
                pl: 1,
                borderLeft: `3px solid ${isOver ? color : 'transparent'}`,
                borderRadius: '0 0 0 4px',
                bgcolor: isOver ? color + '06' : 'transparent',
                transition: 'all 0.15s',
                minHeight: laneProjects.length === 0 ? 48 : undefined,
              }}>
                {laneProjects.map(project => {
                  const sc = STATUS_CFG[project.status] || STATUS_CFG.backlog;
                  const isDragged = draggedProjectId === project.id;
                  return (
                    <Paper key={project.id} draggable
                      onDragStart={e => { setDraggedProjectId(project.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={() => { setDraggedProjectId(null); setProjDragOverLane(null); }}
                      sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.5, borderRadius: 2,
                        borderLeft: '4px solid ' + sc.color, cursor: 'grab', transition: 'all 0.15s',
                        opacity: isDragged ? 0.3 : 1,
                        transform: isDragged ? 'scale(0.98)' : 'none',
                        '&:hover': { boxShadow: 3, bgcolor: '#fafffe' } }}
                      onClick={() => !isDragged && openProject(project.id)}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                          <Typography variant="subtitle1" fontWeight={700} noWrap>{project.name}</Typography>
                          {project.docs_repo && <MenuBook sx={{ fontSize: 16, color: '#1565c0' }} />}
                        </Box>
                        {project.description && (
                          <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 500 }}>{project.description}</Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={0.5} alignItems="center" flexShrink={0}>
                        {sChip(project.status, STATUS_CFG)} {pChip(project.priority)}
                        {project.task_count > 0 && <Chip label={project.task_count + ' úkolů'} size="small" variant="outlined" />}
                      </Stack>
                      {project.labels?.length > 0 && (
                        <Stack direction="row" spacing={0.5} flexShrink={0}>
                          {project.labels.slice(0, 3).map(l => <Chip key={l.id} label={l.name} size="small" sx={{ bgcolor: l.color + '22', color: l.color, fontSize: '0.68rem' }} />)}
                          {project.labels.length > 3 && <Chip label={'+' + (project.labels.length - 3)} size="small" variant="outlined" sx={{ fontSize: '0.68rem' }} />}
                        </Stack>
                      )}
                      {project.task_count > 0 && (
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 100, flexShrink: 0 }}>
                          <LinearProgress variant="determinate" value={project.progress_percent}
                            sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: sc.color } }} />
                          <Typography variant="caption" fontWeight={700} sx={{ minWidth: 30, textAlign: 'right' }}>{project.progress_percent}%</Typography>
                        </Box>
                      )}
                      <Box onClick={e => e.stopPropagation()} sx={{ flexShrink: 0 }}>
                        <IconButton size="small" onClick={() => { setEditingProject({ ...project, label_ids: project.labels?.map(l => l.id) || [] }); setProjectDialogOpen(true); }}><Edit fontSize="small" /></IconButton>
                        <IconButton size="small" color="error" onClick={() => { setDeleteTarget({ type: 'project', id: project.id }); setDeleteConfirmOpen(true); }}><Delete fontSize="small" /></IconButton>
                      </Box>
                    </Paper>
                  );
                })}
                {laneProjects.length === 0 && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'flex', alignItems: 'center', height: 48, px: 1, opacity: 0.5, fontStyle: 'italic' }}>
                    {isOver ? '↓ Přetáhnout sem' : 'Žádné projekty'}
                  </Typography>
                )}
              </Stack>
            </Box>
          );
        })}
      </Box>
    );
  };

  // ======== OVERVIEW ========
  const renderOverview = () => (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h4" fontWeight={700} sx={{ color: COLORS.darkForest }}>Projekty</Typography>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" size="small" onClick={() => setLabelsDialogOpen(true)}>Štítky</Button>
          <Button variant="contained" startIcon={<Add />}
            onClick={() => { setEditingProject({ status: 'backlog', priority: 'medium' }); setProjectDialogOpen(true); }}>
            Nový projekt
          </Button>
        </Stack>
      </Box>
      <Stack direction="row" spacing={1.5} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap alignItems="center">
        <TextField size="small" placeholder="Hledat..." value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)} sx={{ minWidth: 200 }}
          InputProps={{ startAdornment: <FilterList fontSize="small" sx={{ mr: 0.5, color: 'action.active' }} /> }}
        />
        <FormControl size="small" sx={{ minWidth: 130 }}>
          <InputLabel>Priorita</InputLabel>
          <Select value={filterPriority} label="Priorita" onChange={e => setFilterPriority(e.target.value)}>
            <MenuItem value="all">Všechny</MenuItem>
            {Object.entries(PRI_CFG).map(([v, c]) => <MenuItem key={v} value={v}>{c.label}</MenuItem>)}
          </Select>
        </FormControl>
        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Řadit dle</InputLabel>
          <Select value={sortBy} label="Řadit dle" onChange={e => setSortBy(e.target.value as any)}>
            <MenuItem value="status">Stavu</MenuItem>
            <MenuItem value="priority">Priority</MenuItem>
            <MenuItem value="name">Názvu</MenuItem>
            <MenuItem value="progress">Progresu</MenuItem>
          </Select>
        </FormControl>
      </Stack>
      <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap alignItems="center">
        <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, mr: 0.5 }}>Stav:</Typography>
        {PROJ_STATUSES.map(s => {
          const cfg = STATUS_CFG[s];
          const active = filterStatus.has(s);
          return (
            <Chip key={s} label={cfg?.label || s} size="small"
              onClick={() => toggleFilterStatus(s)}
              sx={{
                cursor: 'pointer',
                fontWeight: active ? 700 : 400,
                bgcolor: active ? cfg?.color : (cfg?.color || '#999') + '22',
                color: active ? '#fff' : cfg?.color,
                border: `1px solid ${cfg?.color || '#999'}66`,
                '&:hover': { bgcolor: active ? (cfg?.color || '#999') + 'cc' : (cfg?.color || '#999') + '44' },
                transition: 'all 0.15s',
              }}
            />
          );
        })}
        {filterStatus.size > 0 && (
          <Chip label="Zrušit" size="small" variant="outlined" onClick={() => setFilterStatus(new Set())}
            sx={{ cursor: 'pointer', color: 'text.secondary' }} />
        )}
      </Stack>
      {allLabels.length > 0 && (
        <Stack direction="row" spacing={1} sx={{ mb: 2 }} flexWrap="wrap" useFlexGap alignItems="center">
          <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600, mr: 0.5 }}>Štítky:</Typography>
          {allLabels.map(lbl => {
            const active = filterLabels.has(lbl.id);
            return (
              <Chip
                key={lbl.id}
                label={lbl.name}
                size="small"
                onClick={() => toggleFilterLabel(lbl.id)}
                sx={{
                  cursor: 'pointer',
                  fontWeight: active ? 700 : 400,
                  bgcolor: active ? lbl.color : lbl.color + '22',
                  color: active ? '#fff' : lbl.color,
                  border: `1px solid ${lbl.color}66`,
                  '&:hover': { bgcolor: active ? lbl.color + 'cc' : lbl.color + '44' },
                  transition: 'all 0.15s',
                }}
              />
            );
          })}
          {filterLabels.size > 0 && (
            <Chip label="Zrušit filtry" size="small" variant="outlined" onClick={() => setFilterLabels(new Set())}
              sx={{ cursor: 'pointer', color: 'text.secondary' }} />
          )}
        </Stack>
      )}
      {(sortBy === 'status' || sortBy === 'priority') ? renderProjectSwimlane(sortBy) : (
        <>
          <Stack spacing={1}>
            {filteredProjects.map(project => {
              const sc = STATUS_CFG[project.status] || STATUS_CFG.backlog;
              return (
                <Paper key={project.id}
                  sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2, py: 1.5, borderRadius: 2,
                    borderLeft: '4px solid ' + sc.color, cursor: 'pointer', transition: 'all 0.15s',
                    '&:hover': { boxShadow: 3, bgcolor: '#fafffe' } }}
                  onClick={() => openProject(project.id)}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.25 }}>
                      <Typography variant="subtitle1" fontWeight={700} noWrap>{project.name}</Typography>
                      {project.docs_repo && <MenuBook sx={{ fontSize: 16, color: '#1565c0' }} />}
                    </Box>
                    {project.description && (
                      <Typography variant="body2" color="text.secondary" noWrap sx={{ maxWidth: 500 }}>{project.description}</Typography>
                    )}
                  </Box>
                  <Stack direction="row" spacing={0.5} alignItems="center" flexShrink={0}>
                    {sChip(project.status, STATUS_CFG)} {pChip(project.priority)}
                    {project.task_count > 0 && <Chip label={project.task_count + ' úkolů'} size="small" variant="outlined" />}
                  </Stack>
                  {project.labels?.length > 0 && (
                    <Stack direction="row" spacing={0.5} flexShrink={0}>
                      {project.labels.slice(0, 3).map(l => <Chip key={l.id} label={l.name} size="small" sx={{ bgcolor: l.color + '22', color: l.color, fontSize: '0.68rem' }} />)}
                      {project.labels.length > 3 && <Chip label={'+' + (project.labels.length - 3)} size="small" variant="outlined" sx={{ fontSize: '0.68rem' }} />}
                    </Stack>
                  )}
                  {project.task_count > 0 && (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 100, flexShrink: 0 }}>
                      <LinearProgress variant="determinate" value={project.progress_percent}
                        sx={{ flex: 1, height: 6, borderRadius: 3, bgcolor: '#e0e0e0', '& .MuiLinearProgress-bar': { bgcolor: sc.color } }} />
                      <Typography variant="caption" fontWeight={700} sx={{ minWidth: 30, textAlign: 'right' }}>{project.progress_percent}%</Typography>
                    </Box>
                  )}
                  <Box onClick={e => e.stopPropagation()} sx={{ flexShrink: 0 }}>
                    <IconButton size="small" onClick={() => { setEditingProject({ ...project, label_ids: project.labels?.map(l => l.id) || [] }); setProjectDialogOpen(true); }}><Edit fontSize="small" /></IconButton>
                    <IconButton size="small" color="error" onClick={() => { setDeleteTarget({ type: 'project', id: project.id }); setDeleteConfirmOpen(true); }}><Delete fontSize="small" /></IconButton>
                  </Box>
                </Paper>
              );
            })}
          </Stack>
          {filteredProjects.length === 0 && !loading && (
            <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 2, bgcolor: '#fafafa', mt: 2 }}>
              <Typography color="text.secondary">Žádné projekty. Vytvořte první projekt!</Typography>
            </Paper>
          )}
        </>
      )}
    </Box>
  );

  // Phase colors for visual distinction
  const PHASE_COLORS = ['#9c27b0', '#1565c0', '#2e7d32', '#e65100', '#c62828', '#00838f'];

  // ======== SUB-KANBAN (Pod-úkoly) ========
  const renderSubKanban = (subs: Task[], parentId: number, parentTitle: string) => (
    <Box sx={{ display: 'flex', gap: 1.5, overflowX: 'auto', pb: 1, pt: 1 }}>
      {TASK_STATUSES.map(status => {
        if (hideDone && status === 'done') return null;
        const cfg = TASK_CFG[status];
        const colKey = `sub_${parentId}_${status}`;
        const colTasks = subs.filter(t => t.status === status);
        if (colTasks.length === 0 && !['backlog', 'todo', 'in_progress', 'done'].includes(status)) return null;
        const isActiveCol = ACTIVE_STATUSES.includes(status);
        const isOver = dragOverCol === colKey;
        return (
          <Paper key={status} sx={{ minWidth: 170, flex: '0 0 170px', borderRadius: 1.5,
            bgcolor: isOver ? cfg.color + '08' : '#fff',
            border: isOver ? `2px dashed ${cfg.color}` : '1px solid #e8e8e8',
            transition: 'all 0.2s ease',
            boxShadow: isOver ? `0 0 8px ${cfg.color}22` : 'none',
          }}
            onDragOver={e => { e.preventDefault(); setDragOverCol(colKey); setDragInsertInfo(null); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => { e.preventDefault(); if (draggedTaskId) quickStatus(draggedTaskId, status); resetDragState(); }}>
            <Box sx={{ p: 1, borderBottom: '2px solid ' + cfg.color }}>
              <Typography variant="caption" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label} ({colTasks.length})</Typography>
            </Box>
            <Box sx={{ p: 0.75, minHeight: 50 }}>
              {colTasks.map(sub => {
                const phase = getTaskPhase(sub.id);
                const active = isTaskInActivePhase(sub.id);
                const phColor = phase ? PHASE_COLORS[(phase.number - 1) % PHASE_COLORS.length] : undefined;
                const blocked = !active && isActiveCol;
                const isDragged = draggedTaskId === sub.id;
                const insertBefore = dragInsertInfo?.taskId === sub.id && dragInsertInfo.pos === 'before';
                const insertAfter = dragInsertInfo?.taskId === sub.id && dragInsertInfo.pos === 'after';
                return (
                <Card key={sub.id} draggable={!blocked}
                  onDragStart={e => { if (blocked) { e.preventDefault(); return; } setDraggedTaskId(sub.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={resetDragState}
                  onDragOver={e => handleCardDragOver(e, sub.id)}
                  onDrop={e => handleCardDrop(e, sub.id, status, subs)}
                  onClick={() => selectedProject?.docs_repo ? openDocDetail(sub, parentTitle) : setPreviewTask(sub)}
                  sx={{ mb: 0.75, cursor: blocked ? 'not-allowed' : 'pointer', borderRadius: 1,
                    borderLeft: '2px solid ' + (PRI_CFG[sub.priority] || PRI_CFG.medium).color,
                    borderTop: insertBefore ? '3px solid #007638' : undefined,
                    borderBottom: insertAfter ? '3px solid #007638' : undefined,
                    opacity: isDragged ? 0.3 : !active ? 0.45 : 1,
                    transform: isDragged ? 'scale(0.95) rotate(1deg)' : 'none',
                    transition: 'opacity 0.2s, transform 0.2s, border 0.15s',
                    filter: !active ? 'grayscale(0.5)' : 'none', '&:hover': { boxShadow: active ? 2 : 0 } }}>
                  <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                      {phase && <Chip label={`F${phase.number}`} size="small" sx={{ height: 16, fontSize: '0.6rem', fontWeight: 700, bgcolor: phColor + '22', color: phColor, '& .MuiChip-label': { px: 0.5 } }} />}
                      <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{sub.title}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {pChip(sub.priority)}
                      <Box sx={{ ml: 'auto' }}>
                        <Tooltip title="Náhled"><IconButton size="small" sx={{ p: 0.25, color: '#1565c0' }} onClick={e => { e.stopPropagation(); setPreviewTask(sub); }}><InfoOutlined sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                        <Tooltip title="Duplikovat"><IconButton size="small" sx={{ p: 0.25, color: '#7b1fa2' }} onClick={e => { e.stopPropagation(); openDuplicateDialog(sub); }}><ContentCopy sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                        <IconButton size="small" sx={{ p: 0.25, color: '#e65100' }} onClick={e => { e.stopPropagation(); openTaskDialog(sub); }}><Edit sx={{ fontSize: 14 }} /></IconButton>
                        <IconButton size="small" sx={{ p: 0.25 }} color="error" onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'task', id: sub.id }); setDeleteConfirmOpen(true); }}><Delete sx={{ fontSize: 14 }} /></IconButton>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
                );
              })}
              <TextField size="small" fullWidth placeholder="+ Nový..."
                value={inlineTaskText[colKey] || ''}
                onChange={e => setInlineTaskText(p => ({ ...p, [colKey]: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') handleInlineAdd(status, parentId); }}
                onClick={e => e.stopPropagation()}
                sx={{ mt: 0.5, '& .MuiInputBase-input': { fontSize: '0.75rem', py: 0.5, px: 1 }, '& .MuiOutlinedInput-root': { bgcolor: '#fafafa' } }}
              />
            </Box>
          </Paper>
        );
      }).filter(Boolean)}
    </Box>
  );

  // ======== SUB-SWIMLANE (Pod-úkoly) ========
  const renderSubSwimlane = (subs: Task[], parentId: number, parentTitle: string) => (
    <Box>
      {TASK_STATUSES.map(status => {
        if (hideDone && status === 'done') return null;
        const cfg = TASK_CFG[status];
        const colKey = `sub_${parentId}_${status}`;
        const rowTasks = subs.filter(t => t.status === status);
        if (rowTasks.length === 0 && !['backlog', 'todo', 'in_progress', 'done'].includes(status)) return null;
        const isActiveCol = ACTIVE_STATUSES.includes(status);
        const isOver = dragOverCol === colKey;
        return (
          <Box key={status} sx={{ display: 'flex', mb: 1, borderRadius: 1.5, overflow: 'hidden',
            outline: isOver ? `2px dashed ${cfg.color}` : 'none',
            transition: 'outline 0.2s ease',
          }}
            onDragOver={e => { e.preventDefault(); setDragOverCol(colKey); setDragInsertInfo(null); }}
            onDragLeave={() => setDragOverCol(null)}
            onDrop={e => { e.preventDefault(); if (draggedTaskId) quickStatus(draggedTaskId, status); resetDragState(); }}>
            <Box sx={{ minWidth: 100, p: 1, bgcolor: cfg.bg, display: 'flex', alignItems: 'center', borderLeft: '2px solid ' + cfg.color }}>
              <Typography variant="caption" fontWeight={700} sx={{ color: cfg.color, fontSize: '0.68rem' }}>{cfg.label} ({rowTasks.length})</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 0.75, p: 0.75, flex: 1, overflowX: 'auto', minHeight: 44,
              bgcolor: isOver ? cfg.color + '08' : 'transparent', transition: 'background-color 0.2s',
            }}>
              {rowTasks.map(sub => {
                const phase = getTaskPhase(sub.id);
                const active = isTaskInActivePhase(sub.id);
                const phColor = phase ? PHASE_COLORS[(phase.number - 1) % PHASE_COLORS.length] : undefined;
                const blocked = !active && isActiveCol;
                const isDragged = draggedTaskId === sub.id;
                const insertBefore = dragInsertInfo?.taskId === sub.id && dragInsertInfo.pos === 'before';
                const insertAfter = dragInsertInfo?.taskId === sub.id && dragInsertInfo.pos === 'after';
                return (
                <Card key={sub.id} draggable={!blocked}
                  onDragStart={e => { if (blocked) { e.preventDefault(); return; } setDraggedTaskId(sub.id); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragEnd={resetDragState}
                  onDragOver={e => handleCardDragOver(e, sub.id, true)}
                  onDrop={e => handleCardDrop(e, sub.id, status, subs)}
                  onClick={() => selectedProject?.docs_repo ? openDocDetail(sub, parentTitle) : setPreviewTask(sub)}
                  sx={{ minWidth: 150, cursor: blocked ? 'not-allowed' : 'pointer', borderRadius: 1, flexShrink: 0,
                    borderLeft: insertBefore ? '3px solid #007638' : '2px solid ' + (PRI_CFG[sub.priority] || PRI_CFG.medium).color,
                    borderRight: insertAfter ? '3px solid #007638' : undefined,
                    opacity: isDragged ? 0.3 : !active ? 0.45 : 1,
                    transform: isDragged ? 'scale(0.95) rotate(1deg)' : 'none',
                    transition: 'opacity 0.2s, transform 0.2s, border 0.15s',
                    filter: !active ? 'grayscale(0.5)' : 'none', '&:hover': { boxShadow: active ? 2 : 0 } }}>
                  <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.25 }}>
                      {phase && <Chip label={`F${phase.number}`} size="small" sx={{ height: 16, fontSize: '0.6rem', fontWeight: 700, bgcolor: phColor + '22', color: phColor, '& .MuiChip-label': { px: 0.5 } }} />}
                      <Typography variant="caption" fontWeight={600} sx={{ flex: 1 }}>{sub.title}</Typography>
                    </Box>
                    <Stack direction="row" spacing={0.5} alignItems="center">
                      {pChip(sub.priority)}
                      <Box sx={{ ml: 'auto' }}>
                        <Tooltip title="Náhled"><IconButton size="small" sx={{ p: 0.25, color: '#1565c0' }} onClick={e => { e.stopPropagation(); setPreviewTask(sub); }}><InfoOutlined sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                        <Tooltip title="Duplikovat"><IconButton size="small" sx={{ p: 0.25, color: '#7b1fa2' }} onClick={e => { e.stopPropagation(); openDuplicateDialog(sub); }}><ContentCopy sx={{ fontSize: 14 }} /></IconButton></Tooltip>
                        <IconButton size="small" sx={{ p: 0.25, color: '#e65100' }} onClick={e => { e.stopPropagation(); openTaskDialog(sub); }}><Edit sx={{ fontSize: 14 }} /></IconButton>
                        <IconButton size="small" sx={{ p: 0.25 }} color="error" onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'task', id: sub.id }); setDeleteConfirmOpen(true); }}><Delete sx={{ fontSize: 14 }} /></IconButton>
                      </Box>
                    </Stack>
                  </CardContent>
                </Card>
                );
              })}
            </Box>
          </Box>
        );
      }).filter(Boolean)}
    </Box>
  );

  const renderSubTasks = (subs: Task[], parentId: number, parentTitle: string) => {
    if (taskViewMode === 'swimlane') return renderSubSwimlane(subs, parentId, parentTitle);
    return renderSubKanban(subs, parentId, parentTitle);
  };

  // Phase breakdown for a parent task's subtasks
  const getPhaseBreakdown = (subs: Task[]): { phase: PhaseInfo; count: number; doneCount: number; color: string }[] => {
    if (!phasesData || phasesData.phases.length === 0) return [];
    const result: { phase: PhaseInfo; count: number; doneCount: number; color: string }[] = [];
    for (const phase of phasesData.phases) {
      const matching = subs.filter(s => phase.task_ids.includes(s.id));
      if (matching.length > 0) {
        result.push({
          phase,
          count: matching.length,
          doneCount: matching.filter(s => s.status === 'done').length,
          color: PHASE_COLORS[(phase.number - 1) % PHASE_COLORS.length],
        });
      }
    }
    return result;
  };

  const renderSubtaskIndicator = (subs: Task[]) => {
    const total = subs.length;
    const done = subs.filter(s => s.status === 'done').length;
    const open = Math.max(total - done, 0);
    return (
      <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexWrap: 'wrap' }}>
        <Chip
          size="small"
          icon={<Done sx={{ fontSize: 13 }} />}
          label={done}
          sx={{ height: 20, fontSize: '0.68rem', color: '#2e7d32', bgcolor: '#e8f5e9', '& .MuiChip-label': { px: 0.5 } }}
        />
        {open > 0 && (
          <Chip
            size="small"
            icon={<PlayArrow sx={{ fontSize: 13 }} />}
            label={open}
            sx={{ height: 20, fontSize: '0.68rem', color: '#e65100', bgcolor: '#fff3e0', '& .MuiChip-label': { px: 0.5 } }}
          />
        )}
      </Stack>
    );
  };

  // ======== ÚKOL ROW ========
  const renderUkolRow = (task: Task) => {
    const subs = task.subtasks || [];
    const isExp = expandedUkoly.has(task.id);
    const tc = TASK_CFG[task.status] || TASK_CFG.backlog;
    const phBreakdown = getPhaseBreakdown(subs);
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
            {phBreakdown.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                {phBreakdown.map(pb => (
                  <Chip key={pb.phase.number}
                    label={`F${pb.phase.number}: ${pb.doneCount}/${pb.count}`}
                    size="small"
                    icon={pb.doneCount === pb.count ? <Done sx={{ fontSize: 12 }} /> : undefined}
                    sx={{
                      height: 20, fontSize: '0.68rem', fontWeight: 700,
                      bgcolor: pb.doneCount === pb.count ? pb.color + '22' : pb.phase.number <= (phasesData?.current_phase || 1) ? pb.color + '18' : '#f5f5f5',
                      color: pb.doneCount === pb.count ? pb.color : pb.phase.number <= (phasesData?.current_phase || 1) ? pb.color : '#999',
                      border: '1px solid ' + (pb.phase.number <= (phasesData?.current_phase || 1) ? pb.color + '44' : '#e0e0e0'),
                      '& .MuiChip-label': { px: 0.5 },
                      '& .MuiChip-icon': { ml: 0.25 },
                    }}
                  />
                ))}
              </Stack>
            )}
            {/* Action toolbar below title */}
            <Stack direction="row" spacing={0.25} alignItems="center" sx={{ mt: 0.75 }}>
              <Tooltip title="Náhled">
                <IconButton size="small" sx={{ p: 0.25, color: '#1565c0' }} onClick={() => setPreviewTask(task)}><InfoOutlined sx={{ fontSize: 16 }} /></IconButton>
              </Tooltip>
              <Tooltip title="Přidat pod-úkol">
                <IconButton size="small" sx={{ p: 0.25, color: COLORS.emerald }} onClick={() => openTaskDialog(null, task.id)}><Add sx={{ fontSize: 16 }} /></IconButton>
              </Tooltip>
              <Tooltip title="Duplikovat">
                <IconButton size="small" sx={{ p: 0.25, color: '#7b1fa2' }} onClick={() => openDuplicateDialog(task)}><ContentCopy sx={{ fontSize: 16 }} /></IconButton>
              </Tooltip>
              <Tooltip title="Upravit">
                <IconButton size="small" sx={{ p: 0.25, color: '#e65100' }} onClick={() => openTaskDialog(task)}><Edit sx={{ fontSize: 16 }} /></IconButton>
              </Tooltip>
              <Tooltip title="Smazat">
                <IconButton size="small" sx={{ p: 0.25 }} color="error" onClick={() => { setDeleteTarget({ type: 'task', id: task.id }); setDeleteConfirmOpen(true); }}><Delete sx={{ fontSize: 16 }} /></IconButton>
              </Tooltip>
            </Stack>
          </Box>
          {/* Right side: status/priority + subtask indicators (separated) */}
          <Stack direction="column" alignItems="flex-end" spacing={0.5} flexShrink={0}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              {sChip(task.status, TASK_CFG)} {pChip(task.priority)}
              {(task.comments?.length || 0) > 0 && (
                <Badge badgeContent={task.comments?.length} color="primary"><Comment fontSize="small" color="action" /></Badge>
              )}
            </Stack>
            {subs.length > 0 && renderSubtaskIndicator(subs)}
          </Stack>
        </Paper>
        {subs.length > 0 && (
          <Collapse in={isExp}>
            <Box sx={{ ml: 2, px: 1, pb: 1, bgcolor: '#f8f9fa', border: '1px solid #e0e0e0', borderTop: 'none', borderRadius: '0 0 8px 8px' }}>
              {renderSubTasks(subs, task.id, task.title)}
              <Box sx={{ mt: 0.5 }}>
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
    <>
      <Box sx={{ display: 'flex', gap: 2, overflowX: 'auto', pb: 2 }}>
        {TASK_STATUSES.map(status => {
          if (hideDone && status === 'done') return null;
          const cfg = TASK_CFG[status];
          const colTasks = tasks.filter(t => t.status === status);
          const isOver = dragOverCol === status;
          return (
            <Paper key={status} sx={{ minWidth: 240, flex: '0 0 240px', borderRadius: 2,
              bgcolor: isOver ? cfg.color + '08' : '#f5f5f5',
              border: isOver ? `2px dashed ${cfg.color}` : '2px solid transparent',
              transition: 'all 0.2s ease',
              boxShadow: isOver ? `0 0 12px ${cfg.color}22` : 'none',
            }}
              onDragOver={e => { e.preventDefault(); setDragOverCol(status); setDragInsertInfo(null); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={e => { e.preventDefault(); if (draggedTaskId) quickStatus(draggedTaskId, status); resetDragState(); }}>
              <Box sx={{ p: 1.5, borderBottom: '3px solid ' + cfg.color }}>
                <Typography variant="subtitle2" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label} ({colTasks.length})</Typography>
              </Box>
              <Box sx={{ p: 1, minHeight: 120 }}>
                {colTasks.map(t => {
                  const subs = t.subtasks || [];
                  const isExp = expandedUkoly.has(t.id);
                  const phB = getPhaseBreakdown(subs);
                  const isDragged = draggedTaskId === t.id;
                  const insertBefore = dragInsertInfo?.taskId === t.id && dragInsertInfo.pos === 'before';
                  const insertAfter = dragInsertInfo?.taskId === t.id && dragInsertInfo.pos === 'after';
                  return (
                    <Card key={t.id} draggable
                      onDragStart={e => { setDraggedTaskId(t.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={resetDragState}
                      onDragOver={e => handleCardDragOver(e, t.id)}
                      onDrop={e => handleCardDrop(e, t.id, status, tasks)}
                      onClick={() => toggleUkol(t.id)}
                      sx={{ mb: 1, cursor: 'pointer', borderRadius: 1.5,
                        borderLeft: '3px solid ' + (PRI_CFG[t.priority] || PRI_CFG.medium).color,
                        borderTop: insertBefore ? '3px solid #007638' : undefined,
                        borderBottom: insertAfter ? '3px solid #007638' : undefined,
                        opacity: isDragged ? 0.3 : 1,
                        transform: isDragged ? 'scale(0.95) rotate(1deg)' : 'none',
                        transition: 'opacity 0.2s, transform 0.2s, border 0.15s',
                        outline: isExp ? '2px solid ' + COLORS.emerald : 'none', '&:hover': { boxShadow: 3 } }}>
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{t.title}</Typography>
                        {/* Management icons row */}
                        <Stack direction="row" spacing={0.25} alignItems="center" sx={{ mb: 0.75 }}>
                        <Tooltip title="Náhled"><IconButton size="small" sx={{ p: 0.25, color: '#1565c0' }} onClick={e => { e.stopPropagation(); setPreviewTask(t as Task); }}><InfoOutlined sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                          <Tooltip title="Duplikovat"><IconButton size="small" sx={{ p: 0.25, color: '#7b1fa2' }} onClick={e => { e.stopPropagation(); openDuplicateDialog(t as Task); }}><ContentCopy sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                          <Tooltip title="Upravit"><IconButton size="small" sx={{ p: 0.25, color: '#e65100' }} onClick={e => { e.stopPropagation(); openTaskDialog(t); }}><Edit sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                          <Tooltip title="Smazat"><IconButton size="small" sx={{ p: 0.25 }} color="error" onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'task', id: t.id }); setDeleteConfirmOpen(true); }}><Delete sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                        </Stack>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {subs.length > 0 && renderSubtaskIndicator(subs)}
                        </Stack>
                        {(subs.length > 0 || phB.length > 0) && <Box sx={{ my: 0.5, height: 1, bgcolor: '#e0e0e0' }} />}
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {pChip(t.priority)}
                          {phB.map(pb => (
                            <Chip key={pb.phase.number} label={`F${pb.phase.number}:${pb.doneCount}/${pb.count}`} size="small"
                              sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: pb.color + '18', color: pb.color, border: '1px solid ' + pb.color + '33', '& .MuiChip-label': { px: 0.5 } }} />
                          ))}
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
                <TextField size="small" fullWidth placeholder="+ Nový úkol..."
                  value={inlineTaskText[status] || ''}
                  onChange={e => setInlineTaskText(p => ({ ...p, [status]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleInlineAdd(status); }}
                  onClick={e => e.stopPropagation()}
                  sx={{ mt: 0.5, '& .MuiInputBase-input': { fontSize: '0.8rem', py: 0.6, px: 1 }, '& .MuiOutlinedInput-root': { bgcolor: '#fff' } }}
                />
              </Box>
            </Paper>
          );
        }).filter(Boolean)}
      </Box>
      {tasks.filter(t => expandedUkoly.has(t.id)).map(t => {
        const subs = t.subtasks || [];
        const tc = TASK_CFG[t.status] || TASK_CFG.backlog;
        return (
          <Paper key={'sub-' + t.id} sx={{ p: 2, mb: 2, borderRadius: 2, borderLeft: '4px solid ' + tc.color }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                <SubdirectoryArrowRight fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                Pod-úkoly: {t.title}
              </Typography>
              <Button size="small" startIcon={<Add fontSize="small" />} onClick={() => openTaskDialog(null, t.id)}>
                Přidat pod-úkol
              </Button>
            </Box>
            {subs.length > 0 ? renderSubTasks(subs, t.id, t.title) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Zatím žádné pod-úkoly.</Typography>
            )}
          </Paper>
        );
      })}
    </>
  );

  // ======== SWIMLANE ========
  const renderSwimlane = (tasks: Task[]) => (
    <>
      <Box>
        {TASK_STATUSES.map(status => {
          if (hideDone && status === 'done') return null;
          const cfg = TASK_CFG[status];
          const rowTasks = tasks.filter(t => t.status === status);
          const isOver = dragOverCol === status;
          return (
            <Box key={status} sx={{ display: 'flex', mb: 1.5, borderRadius: 2, overflow: 'hidden',
              outline: isOver ? `2px dashed ${cfg.color}` : 'none',
              transition: 'outline 0.2s ease',
            }}
              onDragOver={e => { e.preventDefault(); setDragOverCol(status); setDragInsertInfo(null); }}
              onDragLeave={() => setDragOverCol(null)}
              onDrop={e => { e.preventDefault(); if (draggedTaskId) quickStatus(draggedTaskId, status); resetDragState(); }}>
              <Box sx={{ minWidth: 130, p: 1.5, bgcolor: cfg.bg, display: 'flex', alignItems: 'center', borderLeft: '3px solid ' + cfg.color }}>
                <Typography variant="caption" fontWeight={700} sx={{ color: cfg.color }}>{cfg.label} ({rowTasks.length})</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 1, p: 1, flex: 1, overflowX: 'auto', minHeight: 60,
                bgcolor: isOver ? cfg.color + '08' : 'transparent', transition: 'background-color 0.2s',
              }}>
                {rowTasks.map(t => {
                  const subs = t.subtasks || [];
                  const isExp = expandedUkoly.has(t.id);
                  const phB = getPhaseBreakdown(subs);
                  const isDragged = draggedTaskId === t.id;
                  const insertBefore = dragInsertInfo?.taskId === t.id && dragInsertInfo.pos === 'before';
                  const insertAfter = dragInsertInfo?.taskId === t.id && dragInsertInfo.pos === 'after';
                  return (
                    <Card key={t.id} draggable
                      onDragStart={e => { setDraggedTaskId(t.id); e.dataTransfer.effectAllowed = 'move'; }}
                      onDragEnd={resetDragState}
                      onDragOver={e => handleCardDragOver(e, t.id, true)}
                      onDrop={e => handleCardDrop(e, t.id, status, tasks)}
                      onClick={() => toggleUkol(t.id)}
                      sx={{ minWidth: 180, cursor: 'pointer', borderRadius: 1.5, flexShrink: 0,
                        borderLeft: insertBefore ? '3px solid #007638' : undefined,
                        borderRight: insertAfter ? '3px solid #007638' : undefined,
                        opacity: isDragged ? 0.3 : 1,
                        transform: isDragged ? 'scale(0.95) rotate(1deg)' : 'none',
                        transition: 'opacity 0.2s, transform 0.2s, border 0.15s',
                        outline: isExp ? '2px solid ' + COLORS.emerald : 'none', '&:hover': { boxShadow: 2 } }}>
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Typography variant="body2" fontWeight={600} sx={{ mb: 0.5 }}>{t.title}</Typography>
                        {/* Management icons row */}
                        <Stack direction="row" spacing={0.25} alignItems="center" sx={{ mb: 0.75 }}>
                        <Tooltip title="Náhled"><IconButton size="small" sx={{ p: 0.25, color: '#1565c0' }} onClick={e => { e.stopPropagation(); setPreviewTask(t as Task); }}><InfoOutlined sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                          <Tooltip title="Duplikovat"><IconButton size="small" sx={{ p: 0.25, color: '#7b1fa2' }} onClick={e => { e.stopPropagation(); openDuplicateDialog(t as Task); }}><ContentCopy sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                          <Tooltip title="Upravit"><IconButton size="small" sx={{ p: 0.25, color: '#e65100' }} onClick={e => { e.stopPropagation(); openTaskDialog(t); }}><Edit sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                          <Tooltip title="Smazat"><IconButton size="small" sx={{ p: 0.25 }} color="error" onClick={e => { e.stopPropagation(); setDeleteTarget({ type: 'task', id: t.id }); setDeleteConfirmOpen(true); }}><Delete sx={{ fontSize: 13 }} /></IconButton></Tooltip>
                        </Stack>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {subs.length > 0 && renderSubtaskIndicator(subs)}
                        </Stack>
                        {(subs.length > 0 || phB.length > 0) && <Box sx={{ my: 0.5, height: 1, bgcolor: '#e0e0e0' }} />}
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {pChip(t.priority)}
                          {phB.map(pb => (
                            <Chip key={pb.phase.number} label={`F${pb.phase.number}:${pb.doneCount}/${pb.count}`} size="small"
                              sx={{ height: 20, fontSize: '0.68rem', fontWeight: 700, bgcolor: pb.color + '18', color: pb.color, border: '1px solid ' + pb.color + '33', '& .MuiChip-label': { px: 0.5 } }} />
                          ))}
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
              </Box>
            </Box>
          );
        }).filter(Boolean)}
      </Box>
      {tasks.filter(t => expandedUkoly.has(t.id)).map(t => {
        const subs = t.subtasks || [];
        const tc = TASK_CFG[t.status] || TASK_CFG.backlog;
        return (
          <Paper key={'sub-' + t.id} sx={{ p: 2, mb: 2, borderRadius: 2, borderLeft: '4px solid ' + tc.color }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant="subtitle1" fontWeight={700}>
                <SubdirectoryArrowRight fontSize="small" sx={{ mr: 0.5, verticalAlign: 'middle' }} />
                Pod-úkoly: {t.title}
              </Typography>
              <Button size="small" startIcon={<Add fontSize="small" />} onClick={() => openTaskDialog(null, t.id)}>
                Přidat pod-úkol
              </Button>
            </Box>
            {subs.length > 0 ? renderSubTasks(subs, t.id, t.title) : (
              <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>Zatím žádné pod-úkoly.</Typography>
            )}
          </Paper>
        );
      })}
    </>
  );

  // ======== DOC DETAIL PANEL ========
  const renderDocDetail = () => {
    if (!docDetailTask) return null;
    return (
      <Dialog open={!!docDetailTask} onClose={() => { setDocDetailTask(null); setDocContent(null); setDocPath(null); }} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <MenuBook fontSize="small" />
            {docDetailTask.title}
          </Box>
          <Stack direction="row" spacing={0.5}>
            {sChip(docDetailTask.status, TASK_CFG)} {pChip(docDetailTask.priority)}
            <IconButton size="small" onClick={() => { setDocDetailTask(null); openTaskDialog(docDetailTask); }}><Edit fontSize="small" /></IconButton>
          </Stack>
        </DialogTitle>
        <DialogContent>
          {docLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}><CircularProgress /></Box>
          ) : docContent ? (
            <Box sx={{ fontFamily: 'system-ui, sans-serif', fontSize: '0.9rem', lineHeight: 1.7,
              '& h1': { fontSize: '1.4rem', fontWeight: 700, mt: 2, mb: 1, color: COLORS.darkForest },
              '& h2': { fontSize: '1.15rem', fontWeight: 700, mt: 2, mb: 0.5, color: '#333' },
              '& h3': { fontSize: '1rem', fontWeight: 600, mt: 1.5, mb: 0.5 },
              '& ul, & ol': { pl: 3 }, '& li': { mb: 0.5 },
              '& code': { bgcolor: '#f5f5f5', px: 0.5, borderRadius: 0.5, fontFamily: 'monospace', fontSize: '0.85em' },
              '& pre': { bgcolor: '#f5f5f5', p: 2, borderRadius: 1, overflow: 'auto', '& code': { bgcolor: 'transparent', p: 0 } },
              '& table': { borderCollapse: 'collapse', width: '100%', mb: 2, '& th, & td': { border: '1px solid #ddd', p: 1, textAlign: 'left' }, '& th': { bgcolor: '#f5f5f5', fontWeight: 600 } },
              '& hr': { my: 2, border: 'none', borderTop: '1px solid #e0e0e0' },
              '& blockquote': { borderLeft: '3px solid ' + COLORS.emerald, pl: 2, ml: 0, color: '#555', fontStyle: 'italic' },
              '& .task-checkbox': { cursor: 'pointer', mr: 1, transform: 'scale(1.2)', accentColor: COLORS.emerald },
            }}>
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  li: ({ children, node }) => {
                    const inputChild = node?.children?.find((c: any) => c.tagName === 'input' && c.properties?.type === 'checkbox');
                    if (inputChild) {
                      const checked = (inputChild as any).properties?.checked || false;
                      const pos = node?.position?.start?.line;
                      const lineIdx = pos ? pos - 1 : -1;
                      return (
                        <li style={{ listStyle: 'none', marginLeft: -20 }}>
                          <input
                            type="checkbox"
                            className="task-checkbox"
                            checked={checked}
                            onChange={() => { if (lineIdx >= 0) toggleDocCheckbox(lineIdx); }}
                          />
                          {children}
                        </li>
                      );
                    }
                    return <li>{children}</li>;
                  },
                  input: ({ type, checked }) => {
                    if (type === 'checkbox') return null;
                    return <input type={type} checked={checked} readOnly />;
                  },
                }}
              >{docContent}</ReactMarkdown>
            </Box>
          ) : (
            <Paper sx={{ p: 3, textAlign: 'center', bgcolor: '#fafafa', borderRadius: 2 }}>
              <Typography color="text.secondary">
                Pro tento pod-úkol nebyla nalezena dokumentace.
              </Typography>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                Vytvořte soubor v docs/{selectedProject?.docs_repo}/ pro propojení.
              </Typography>
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDocDetailTask(null); setDocContent(null); setDocPath(null); }}>Zavřít</Button>
        </DialogActions>
      </Dialog>
    );
  };

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

        {/* Phase stepper */}
        {phasesData && phasesData.phases.length > 0 && (
          <Paper sx={{ p: 2, mb: 3, borderRadius: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Typography variant="subtitle2" fontWeight={700} sx={{ color: COLORS.darkForest, whiteSpace: 'nowrap' }}>
                Projektové fáze
              </Typography>
              <Box sx={{ display: 'flex', gap: 0.5, flex: 1, overflowX: 'auto' }}>
                {phasesData.phases.map(phase => {
                  const isCurrent = phase.number === phasesData.current_phase;
                  const isPast = phase.number < phasesData.current_phase;
                  const phColor = PHASE_COLORS[(phase.number - 1) % PHASE_COLORS.length];
                  const phaseDone = phase.task_ids.every(id => {
                    const t = allTasks.find(at => at.id === id);
                    return t?.status === 'done';
                  });
                  return (
                    <Chip
                      key={phase.number}
                      label={`${phase.label} (${phase.task_ids.length})`}
                      size="small"
                      icon={isPast || phaseDone ? <Done sx={{ fontSize: 14 }} /> : isCurrent ? <PlayArrow sx={{ fontSize: 14 }} /> : undefined}
                      onClick={() => setCurrentPhase(phase.number)}
                      sx={{
                        fontWeight: 700,
                        fontSize: '0.75rem',
                        bgcolor: isCurrent ? phColor : isPast ? phColor + '22' : '#f5f5f5',
                        color: isCurrent ? '#fff' : isPast ? phColor : '#888',
                        border: isCurrent ? 'none' : '1px solid ' + (isPast ? phColor + '44' : '#ddd'),
                        cursor: 'pointer',
                        '&:hover': { bgcolor: isCurrent ? phColor : phColor + '33' },
                      }}
                    />
                  );
                })}
              </Box>
            </Box>
          </Paper>
        )}

        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h5" fontWeight={700} sx={{ color: COLORS.darkForest }}>Úkoly</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title={hideDone ? 'Zobrazit hotové úkoly' : 'Skrýt hotové úkoly'}>
              <IconButton size="small" onClick={() => setHideDone(h => !h)} sx={{ color: hideDone ? '#e65100' : 'action.active' }}>
                {hideDone ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
              </IconButton>
            </Tooltip>
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
  const dialogTitle = isDuplicating
    ? (parentForNewTask !== null ? 'Duplikovat pod-úkol' : 'Duplikovat úkol')
    : isEdit ? 'Upravit' : (parentForNewTask ? 'Nový pod-úkol' : 'Nový úkol');

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
      <Dialog open={taskDialogOpen} onClose={() => { setTaskDialogOpen(false); setParentForNewTask(null); setIsDuplicating(false); setCopySubtasks(false); setDuplicateSourceSubtasks([]); }} maxWidth="md" fullWidth>
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

            {isDuplicating && duplicateSourceSubtasks.length > 0 && (
              <FormControlLabel
                control={<Checkbox checked={copySubtasks} onChange={e => setCopySubtasks(e.target.checked)} />}
                label={<Typography variant="body2">Kopírovat i pod-úkoly ({duplicateSourceSubtasks.length} ks)</Typography>}
              />
            )}

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
        <DialogActions sx={{ justifyContent: editingTask?.id ? 'space-between' : 'flex-end' }}>
          {editingTask?.id && (
            <Button color="error" startIcon={<Delete fontSize="small" />}
              onClick={() => { setTaskDialogOpen(false); setDeleteTarget({ type: 'task', id: editingTask.id! }); setDeleteConfirmOpen(true); }}>
              Smazat
            </Button>
          )}
          <Box>
            <Button onClick={() => { setTaskDialogOpen(false); setParentForNewTask(null); setIsDuplicating(false); setCopySubtasks(false); setDuplicateSourceSubtasks([]); }} sx={{ mr: 1 }}>Zrušit</Button>
            <Button variant="contained" onClick={handleSaveTask}>{editingTask?.id ? 'Uložit' : 'Vytvořit'}</Button>
          </Box>
        </DialogActions>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)}>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <WarningAmber sx={{ color: '#e65100' }} /> Potvrdit smazání
        </DialogTitle>
        <DialogContent>
          {(() => {
            const info = getDeleteInfo();
            return (
              <>
                <Typography>
                  Opravdu chcete smazat {deleteTarget?.type === 'project' ? 'projekt' : 'úkol'} <strong>{info?.label}</strong>?
                </Typography>
                {info?.details && (
                  <Alert severity="warning" sx={{ mt: 1.5 }} icon={false}>
                    {info.details}
                  </Alert>
                )}
                <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>Tato akce je nevratná.</Typography>
              </>
            );
          })()}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirmOpen(false)}>Zrušit</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>Smazat</Button>
        </DialogActions>
      </Dialog>

      {/* Task preview dialog */}
      <Dialog open={!!previewTask} onClose={() => setPreviewTask(null)} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 1 }}>
          <InfoOutlined sx={{ color: COLORS.emerald }} />
          <Typography variant="h6" sx={{ flex: 1 }}>{previewTask?.title}</Typography>
        </DialogTitle>
        <DialogContent>
          {previewTask?.description && (
            <Box sx={{ mb: 2, p: 1.5, bgcolor: '#fafafa', borderRadius: 1, border: '1px solid #e0e0e0', position: 'relative' }}>
              <Tooltip title="Kopírovat popis">
                <IconButton size="small" sx={{ position: 'absolute', top: 6, right: 6, color: '#7b1fa2' }}
                  onClick={() => {
                    const text = previewTask.description || '';
                    const copyViaExec = () => {
                      const el = document.createElement('textarea');
                      el.value = text;
                      el.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
                      document.body.appendChild(el);
                      el.focus();
                      el.select();
                      document.execCommand('copy');
                      document.body.removeChild(el);
                      showSnack('Popis zkopírován');
                    };
                    if (navigator.clipboard && window.isSecureContext) {
                      navigator.clipboard.writeText(text).then(() => showSnack('Popis zkopírován')).catch(copyViaExec);
                    } else {
                      copyViaExec();
                    }
                  }}>
                  <ContentCopy sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.85rem', pr: 3 }}>{previewTask.description}</Typography>
            </Box>
          )}
          {(previewTask?.comments?.length || 0) > 0 && (
            <>
              <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <Comment fontSize="small" /> Komentáře ({previewTask!.comments.length})
              </Typography>
              <Box sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 1, mb: 2 }}>
                {previewTask!.comments.map((c: any) => (
                  <Box key={c.id} sx={{ mb: 1, p: 1, bgcolor: '#fff', borderRadius: 1, border: '1px solid #f0f0f0' }}>
                    <Typography variant="caption" fontWeight={600}>{c.author}</Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>{c.created_at ? new Date(c.created_at).toLocaleString('cs-CZ') : ''}</Typography>
                    <Typography variant="body2" sx={{ mt: 0.25 }}>{c.content}</Typography>
                  </Box>
                ))}
              </Box>
            </>
          )}
          {(previewTask?.notes?.length || 0) > 0 && (
            <>
              <Typography variant="subtitle2" fontWeight={700} sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 1 }}>
                <StickyNote2 fontSize="small" /> Poznámky ({previewTask!.notes.length})
              </Typography>
              <Box sx={{ maxHeight: 200, overflowY: 'auto', bgcolor: '#fafafa', borderRadius: 1, p: 1 }}>
                {previewTask!.notes.map((n: TaskNote) => {
                  const bc: Record<string, string> = { bug: '#c62828', note: '#1565c0', idea: '#ff9800' };
                  return (
                    <Box key={n.id} sx={{ mb: 1, p: 1, bgcolor: '#fff', borderRadius: 1, borderLeft: '3px solid ' + (bc[n.note_type] || '#999') }}>
                      <Typography variant="body2" sx={{ opacity: n.resolved ? 0.5 : 1, textDecoration: n.resolved ? 'line-through' : 'none' }}>{n.content}</Typography>
                    </Box>
                  );
                })}
              </Box>
            </>
          )}
          {!previewTask?.description && !previewTask?.comments?.length && !previewTask?.notes?.length && (
            <Typography color="text.secondary" variant="body2" sx={{ py: 2, textAlign: 'center' }}>Žádné podrobnosti.</Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setPreviewTask(null); openTaskDialog(previewTask!); }}>Upravit</Button>
          <Button variant="contained" onClick={() => setPreviewTask(null)}>Zavřít</Button>
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

      {renderDocDetail()}

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(p => ({ ...p, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar(p => ({ ...p, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
