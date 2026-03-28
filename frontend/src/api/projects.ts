import axios from 'axios';

// ---- Types ----
export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  docs_repo: string | null;
  priority: string;
  status: string;
  location: string | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  progress_percent: number;
  target_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  task_count: number;
  labels: Label[];
  members: ProjectMember[];
}

export interface Task {
  id: number;
  project_id: number;
  sprint_id: number | null;
  parent_task_id: number | null;
  title: string;
  description: string | null;
  task_type: string;
  status: string;
  priority: string;
  story_points: number | null;
  estimated_hours: number | null;
  actual_hours: number | null;
  assigned_to: string | null;
  sort_order: number;
  due_date: string | null;
  created_at: string | null;
  updated_at: string | null;
  created_by: string | null;
  comments: TaskComment[];
  labels: Label[];
  notes: TaskNote[];
  audit_logs: TaskAudit[];
  subtasks: Task[];
}

export interface TaskComment {
  id: number;
  task_id: number;
  author: string;
  content: string;
  created_at: string | null;
}

export interface TaskNote {
  id: number;
  task_id: number;
  note_type: string;
  content: string;
  author: string;
  resolved: boolean;
  promoted_task_id: number | null;
  created_at: string | null;
}

export interface TaskAudit {
  id: number;
  task_id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_by: string;
  changed_at: string | null;
}

export interface Label {
  id: number;
  name: string;
  color: string;
  description: string | null;
  created_at: string | null;
}

export interface ProjectMember {
  id: number;
  project_id: number;
  username: string;
  role: string;
  added_at: string | null;
}

export interface ProjectDetail extends Project {
  tasks: Task[];
}

export interface ProjectStats {
  total_projects: number;
  by_status: Record<string, number>;
  by_priority: Record<string, number>;
  total_tasks: number;
  tasks_by_status: Record<string, number>;
  completion_rate: number;
}

// ---- API Client ----
const api = axios.create({
  baseURL: '/api/v1',
  headers: { 'Content-Type': 'application/json' },
});

const BASE = '/projects';

export const projectsApi = {
  // Projects
  list: async (params?: { status?: string; priority?: string; search?: string }) => {
    const r = await api.get<Project[]>(`${BASE}/`, { params });
    return r.data;
  },
  getStats: async () => {
    const r = await api.get<ProjectStats>(`${BASE}/stats`);
    return r.data;
  },
  get: async (id: number) => {
    const r = await api.get<ProjectDetail>(`${BASE}/${id}`);
    return r.data;
  },
  create: async (data: Partial<Project> & { label_ids?: number[] }) => {
    const r = await api.post<Project>(`${BASE}/`, data);
    return r.data;
  },
  update: async (id: number, data: Partial<Project> & { label_ids?: number[] }) => {
    const r = await api.patch<Project>(`${BASE}/${id}`, data);
    return r.data;
  },
  delete: async (id: number) => {
    await api.delete(`${BASE}/${id}`);
  },

  // Tasks
  listTasks: async (projectId: number) => {
    const r = await api.get<Task[]>(`${BASE}/${projectId}/tasks`);
    return r.data;
  },
  createTask: async (projectId: number, data: Partial<Task>) => {
    const r = await api.post<Task>(`${BASE}/${projectId}/tasks`, { ...data, project_id: projectId });
    return r.data;
  },
  getTask: async (taskId: number) => {
    const r = await api.get<Task>(`/tasks/${taskId}`);
    return r.data;
  },
  updateTask: async (taskId: number, data: Partial<Task>) => {
    const r = await api.patch<Task>(`/tasks/${taskId}`, data);
    return r.data;
  },
  deleteTask: async (taskId: number) => {
    await api.delete(`/tasks/${taskId}`);
  },

  // Comments
  addComment: async (taskId: number, content: string) => {
    const r = await api.post<TaskComment>(`/tasks/${taskId}/comments`, { content });
    return r.data;
  },

  // Notes
  addNote: async (taskId: number, note_type: string, content: string) => {
    const r = await api.post<TaskNote>(`/tasks/${taskId}/notes`, { note_type, content });
    return r.data;
  },
  toggleNoteResolved: async (noteId: number) => {
    const r = await api.patch<TaskNote>(`/notes/${noteId}/resolve`);
    return r.data;
  },
  promoteIdea: async (noteId: number) => {
    const r = await api.post<TaskNote>(`/notes/${noteId}/promote`);
    return r.data;
  },

  // Audit
  getTaskAudit: async (taskId: number) => {
    const r = await api.get<TaskAudit[]>(`/tasks/${taskId}/audit`);
    return r.data;
  },

  // Labels
  listLabels: async () => {
    const r = await api.get<Label[]>(`/labels/`);
    return r.data;
  },
  createLabel: async (data: { name: string; color?: string; description?: string }) => {
    const r = await api.post<Label>(`/labels/`, data);
    return r.data;
  },
  updateLabel: async (id: number, data: { name?: string; color?: string; description?: string }) => {
    const r = await api.patch<Label>(`/labels/${id}`, data);
    return r.data;
  },
  deleteLabel: async (id: number) => {
    await api.delete(`/labels/${id}`);
  },

  // Members
  addMember: async (projectId: number, username: string, role: string = 'developer') => {
    const r = await api.post<ProjectMember>(`${BASE}/${projectId}/members`, { username, role });
    return r.data;
  },
  removeMember: async (projectId: number, memberId: number) => {
    await api.delete(`${BASE}/${projectId}/members/${memberId}`);
  },

  // Activity
  getActivity: async (projectId: number) => {
    const r = await api.get(`${BASE}/${projectId}/activity`);
    return r.data;
  },
};

// ---- Docs API ----
export interface DocFile {
  name: string;
  path: string;
  is_dir: boolean;
}

export interface DocContent {
  path: string;
  content: string;
  filename: string;
}

export interface GitSyncStatus {
  repo: string;
  local_commit: string;
  local_date: string;
  remote_commit: string | null;
  remote_date: string | null;
  is_synced: boolean;
  behind_count: number;
}

export const docsApi = {
  listRepos: async (): Promise<string[]> => {
    const r = await api.get<string[]>('/docs/repos');
    return r.data;
  },
  listFiles: async (repo: string, subdir: string = ''): Promise<DocFile[]> => {
    const r = await api.get<DocFile[]>(`/docs/${repo}/tree`, { params: { subdir } });
    return r.data;
  },
  readFile: async (repo: string, path: string): Promise<DocContent> => {
    const r = await api.get<DocContent>(`/docs/${repo}/file`, { params: { path } });
    return r.data;
  },
  checkSync: async (repo: string): Promise<GitSyncStatus> => {
    const r = await api.get<GitSyncStatus>(`/docs/${repo}/sync`);
    return r.data;
  },
  pullRepo: async (repo: string): Promise<{ status: string; output: string }> => {
    const r = await api.post<{ status: string; output: string }>(`/docs/${repo}/pull`);
    return r.data;
  },
};

export default projectsApi;
