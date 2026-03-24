import { useState, useEffect, useCallback } from 'react';
import {
  Box, Typography, Paper, Button, IconButton, Stack, Chip,
  CircularProgress, Alert, Snackbar, Breadcrumbs, Link,
  List, ListItemButton, ListItemIcon, ListItemText,
  Divider, Tooltip,
} from '@mui/material';
import {
  Folder, Description, ArrowBack, Sync, SyncProblem,
  CloudDone, CloudDownload, CheckCircle, Schedule,
} from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { docsApi } from '../api/projects';
import type { DocFile, DocContent, GitSyncStatus } from '../api/projects';

const COLORS = {
  darkForest: '#00472e',
  emerald: '#007638',
};

interface Props {
  repo: string;
  onBack: () => void;
}

export default function DocsBrowser({ repo, onBack }: Props) {
  const [files, setFiles] = useState<DocFile[]>([]);
  const [currentDir, setCurrentDir] = useState('');
  const [docContent, setDocContent] = useState<DocContent | null>(null);
  const [syncStatus, setSyncStatus] = useState<GitSyncStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [pulling, setPulling] = useState(false);
  const [syncChecking, setSyncChecking] = useState(false);
  const [snackbar, setSnackbar] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false, message: '', severity: 'success',
  });

  const loadFiles = useCallback(async (subdir: string = '') => {
    setLoading(true);
    try {
      const items = await docsApi.listFiles(repo, subdir);
      setFiles(items);
      setCurrentDir(subdir);
      setDocContent(null);
    } catch {
      setSnackbar({ open: true, message: 'Failed to load files', severity: 'error' });
    } finally {
      setLoading(false);
    }
  }, [repo]);

  const checkSync = useCallback(async () => {
    setSyncChecking(true);
    try {
      const status = await docsApi.checkSync(repo);
      setSyncStatus(status);
    } catch {
      // Silently fail sync check
    } finally {
      setSyncChecking(false);
    }
  }, [repo]);

  useEffect(() => {
    loadFiles();
    checkSync();
  }, [loadFiles, checkSync]);

  const handleOpenFile = async (file: DocFile) => {
    if (file.is_dir) {
      loadFiles(file.path);
    } else {
      setLoading(true);
      try {
        const content = await docsApi.readFile(repo, file.path);
        setDocContent(content);
      } catch {
        setSnackbar({ open: true, message: 'Failed to read file', severity: 'error' });
      } finally {
        setLoading(false);
      }
    }
  };

  const handlePull = async () => {
    setPulling(true);
    try {
      const result = await docsApi.pullRepo(repo);
      setSnackbar({ open: true, message: `Updated: ${result.output}`, severity: 'success' });
      checkSync();
      loadFiles(currentDir);
    } catch {
      setSnackbar({ open: true, message: 'Pull failed', severity: 'error' });
    } finally {
      setPulling(false);
    }
  };

  const navigateBreadcrumb = (index: number) => {
    if (docContent) {
      setDocContent(null);
      return;
    }
    if (index === -1) {
      loadFiles();
    } else {
      const parts = currentDir.split('/');
      const newDir = parts.slice(0, index + 1).join('/');
      loadFiles(newDir);
    }
  };

  const breadcrumbParts = currentDir ? currentDir.split('/') : [];

  return (
    <Box>
      {/* Header */}
      <Paper sx={{ p: 2, mb: 2, borderRadius: 2, background: `linear-gradient(135deg, ${COLORS.darkForest} 0%, ${COLORS.emerald} 100%)`, color: 'white' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton size="small" onClick={onBack} sx={{ color: 'white' }}>
              <ArrowBack />
            </IconButton>
            <Typography variant="h6" fontWeight={700}>
              📁 {repo}
            </Typography>
          </Box>
          <Stack direction="row" spacing={1} alignItems="center">
            {syncStatus && (
              <Tooltip title={
                syncStatus.is_synced
                  ? `In sync — commit ${syncStatus.local_commit} (${new Date(syncStatus.local_date).toLocaleDateString()})`
                  : `${syncStatus.behind_count} commit(s) behind remote`
              }>
                <Chip
                  size="small"
                  icon={syncStatus.is_synced ? <CloudDone fontSize="small" /> : <SyncProblem fontSize="small" />}
                  label={syncStatus.is_synced ? 'Synced' : `${syncStatus.behind_count} behind`}
                  sx={{
                    bgcolor: syncStatus.is_synced ? 'rgba(255,255,255,0.2)' : '#ff980055',
                    color: 'white',
                    fontWeight: 600,
                    '& .MuiChip-icon': { color: 'white' },
                  }}
                />
              </Tooltip>
            )}
            <Tooltip title="Check for updates">
              <IconButton size="small" onClick={checkSync} disabled={syncChecking} sx={{ color: 'white' }}>
                <Sync fontSize="small" sx={{ animation: syncChecking ? 'spin 1s linear infinite' : 'none', '@keyframes spin': { '0%': { transform: 'rotate(0deg)' }, '100%': { transform: 'rotate(360deg)' } } }} />
              </IconButton>
            </Tooltip>
            {syncStatus && !syncStatus.is_synced && (
              <Button
                size="small" variant="contained"
                startIcon={pulling ? <CircularProgress size={14} color="inherit" /> : <CloudDownload fontSize="small" />}
                onClick={handlePull} disabled={pulling}
                sx={{ bgcolor: 'rgba(255,255,255,0.2)', '&:hover': { bgcolor: 'rgba(255,255,255,0.3)' } }}
              >
                Pull
              </Button>
            )}
          </Stack>
        </Box>
        {syncStatus && (
          <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
            <Chip
              size="small"
              icon={<Schedule fontSize="small" />}
              label={`Last commit: ${new Date(syncStatus.local_date).toLocaleString()}`}
              sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: 'white', fontSize: '0.7rem', '& .MuiChip-icon': { color: 'white' } }}
            />
            <Chip
              size="small"
              icon={<CheckCircle fontSize="small" />}
              label={syncStatus.local_commit}
              sx={{ bgcolor: 'rgba(255,255,255,0.15)', color: 'white', fontSize: '0.7rem', fontFamily: 'monospace', '& .MuiChip-icon': { color: 'white' } }}
            />
          </Stack>
        )}
      </Paper>

      {/* Breadcrumbs */}
      <Paper sx={{ px: 2, py: 1, mb: 2, borderRadius: 2 }}>
        <Breadcrumbs>
          <Link
            underline="hover" color="inherit" sx={{ cursor: 'pointer', fontWeight: currentDir || docContent ? 400 : 700 }}
            onClick={() => navigateBreadcrumb(-1)}
          >
            {repo}
          </Link>
          {breadcrumbParts.map((part, i) => (
            <Link
              key={i} underline="hover" color="inherit"
              sx={{ cursor: 'pointer', fontWeight: i === breadcrumbParts.length - 1 && !docContent ? 700 : 400 }}
              onClick={() => navigateBreadcrumb(i)}
            >
              {part}
            </Link>
          ))}
          {docContent && (
            <Typography color="text.primary" fontWeight={700}>
              {docContent.filename}
            </Typography>
          )}
        </Breadcrumbs>
      </Paper>

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : docContent ? (
        /* Markdown content */
        <Paper sx={{ p: 3, borderRadius: 2 }}>
          <Box sx={{
            '& h1': { color: COLORS.darkForest, borderBottom: '2px solid #e0e0e0', pb: 1, mb: 2 },
            '& h2': { color: COLORS.emerald, mt: 3, mb: 1.5 },
            '& h3': { color: '#333', mt: 2, mb: 1 },
            '& table': { borderCollapse: 'collapse', width: '100%', my: 2, fontSize: '0.875rem' },
            '& th, & td': { border: '1px solid #ddd', px: 1.5, py: 0.75, textAlign: 'left' },
            '& th': { bgcolor: '#f5f5f5', fontWeight: 700 },
            '& tr:hover': { bgcolor: '#fafafa' },
            '& code': { bgcolor: '#f5f5f5', px: 0.75, py: 0.25, borderRadius: '4px', fontSize: '0.85rem', fontFamily: 'monospace' },
            '& pre': { bgcolor: '#f5f5f5', p: 2, borderRadius: 2, overflow: 'auto', fontSize: '0.85rem' },
            '& pre code': { bgcolor: 'transparent', p: 0 },
            '& a': { color: COLORS.emerald },
            '& blockquote': { borderLeft: `3px solid ${COLORS.emerald}`, pl: 2, ml: 0, color: '#555' },
            '& ul': { pl: 3 },
            '& ol': { pl: 3 },
            '& li': { mb: 0.5 },
            '& input[type="checkbox"]': { mr: 1 },
            '& img': { maxWidth: '100%', borderRadius: 1 },
            '& hr': { border: 'none', borderTop: '1px solid #e0e0e0', my: 2 },
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{docContent.content}</ReactMarkdown>
          </Box>
        </Paper>
      ) : (
        /* File list */
        <Paper sx={{ borderRadius: 2, overflow: 'hidden' }}>
          <List disablePadding>
            {files.length === 0 && (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography color="text.secondary">No markdown documents found.</Typography>
              </Box>
            )}
            {files.map((file, i) => (
              <Box key={file.path}>
                {i > 0 && <Divider />}
                <ListItemButton onClick={() => handleOpenFile(file)} sx={{ py: 1.5 }}>
                  <ListItemIcon sx={{ minWidth: 40 }}>
                    {file.is_dir
                      ? <Folder sx={{ color: '#ffa726' }} />
                      : <Description sx={{ color: COLORS.emerald }} />
                    }
                  </ListItemIcon>
                  <ListItemText
                    primary={file.name.replace('.md', '')}
                    primaryTypographyProps={{ fontWeight: file.is_dir ? 600 : 400 }}
                  />
                </ListItemButton>
              </Box>
            ))}
          </List>
        </Paper>
      )}

      <Snackbar open={snackbar.open} autoHideDuration={4000} onClose={() => setSnackbar(prev => ({ ...prev, open: false }))} anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}>
        <Alert severity={snackbar.severity} variant="filled" onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}>{snackbar.message}</Alert>
      </Snackbar>
    </Box>
  );
}
