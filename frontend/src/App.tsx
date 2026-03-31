import { useState, useEffect, useCallback, useRef } from 'react';
import { ThemeProvider, createTheme, CssBaseline, Box, Tabs, Tab, Chip, Tooltip, Badge, Snackbar, Alert } from '@mui/material';
import { Assignment, MenuBook, CloudDone, SyncProblem, FiberNew } from '@mui/icons-material';
import ProjectsDashboard from './components/ProjectsDashboard';
import DocsBrowser from './components/DocsBrowser';
import { docsApi } from './api/projects';
import projectsApi from './api/projects';

const theme = createTheme({
  palette: {
    primary: { main: '#007638', dark: '#00472e', light: '#01935e' },
    secondary: { main: '#1565c0' },
    background: { default: '#f5f6f8' },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
  },
  shape: { borderRadius: 8 },
});

export default function App() {
  const [tab, setTab] = useState(0);
  const [docsRepos, setDocsRepos] = useState<string[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [syncStatuses, setSyncStatuses] = useState<Record<string, boolean>>({});
  const [repoProjectMap, setRepoProjectMap] = useState<Record<string, number>>({});
  const [dashboardKey, setDashboardKey] = useState(0);
  const [docsChanges, setDocsChanges] = useState(0);
  const [changeSnack, setChangeSnack] = useState<string | null>(null);
  const fingerprintsRef = useRef<Record<string, string>>({});

  const loadRepos = useCallback(async () => {
    try {
      const repos = await docsApi.listRepos();
      setDocsRepos(repos);
      const statuses: Record<string, boolean> = {};
      for (const repo of repos) {
        try {
          const s = await docsApi.checkSync(repo);
          statuses[repo] = s.is_synced;
        } catch { /* skip */ }
      }
      setSyncStatuses(statuses);
      // Load project-repo mapping
      try {
        const projects = await projectsApi.list();
        const mapping: Record<string, number> = {};
        for (const p of projects) {
          if (p.docs_repo) mapping[p.docs_repo] = p.id;
        }
        setRepoProjectMap(mapping);
      } catch { /* skip */ }
    } catch { /* skip */ }
  }, []);

  useEffect(() => { loadRepos(); }, [loadRepos]);

  // Poll for NFS doc changes every 30s
  useEffect(() => {
    let cancelled = false;
    const checkChanges = async () => {
      try {
        const data = await docsApi.checkChanges();
        const prev = fingerprintsRef.current;
        let changedCount = 0;
        const changedRepos: string[] = [];
        for (const [repo, info] of Object.entries(data)) {
          if (prev[repo] && prev[repo] !== info.fingerprint) {
            changedCount++;
            changedRepos.push(repo);
          }
        }
        // Store current fingerprints
        const newFp: Record<string, string> = {};
        for (const [repo, info] of Object.entries(data)) newFp[repo] = info.fingerprint;
        fingerprintsRef.current = newFp;
        // Only notify if we had previous data (skip first load)
        if (Object.keys(prev).length > 0 && changedCount > 0 && !cancelled) {
          setDocsChanges(c => c + changedCount);
          setChangeSnack(`Změna v dokumentaci: ${changedRepos.join(', ')}`);
        }
      } catch { /* silent */ }
    };
    checkChanges();
    const interval = setInterval(checkChanges, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const allSynced = docsRepos.length === 0 || docsRepos.every(r => syncStatuses[r] !== false);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ borderBottom: 1, borderColor: 'divider', px: 3, bgcolor: '#fff' }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setSelectedRepo(null); if (v === 1) setDocsChanges(0); }}>
          <Tab icon={<Assignment fontSize="small" />} iconPosition="start" label="Projekty" />
          <Tab
            icon={<MenuBook fontSize="small" />}
            iconPosition="start"
            label={
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <Badge badgeContent={docsChanges} color="error" max={9}
                  sx={{ '& .MuiBadge-badge': { fontSize: '0.65rem', minWidth: 16, height: 16 } }}>
                  <span>Docs</span>
                </Badge>
                {docsRepos.length > 0 && (
                  <Tooltip title={allSynced ? 'All repos synced' : 'Some repos out of sync'}>
                    {allSynced
                      ? <CloudDone sx={{ fontSize: 16, color: '#2e7d32' }} />
                      : <SyncProblem sx={{ fontSize: 16, color: '#e65100' }} />
                    }
                  </Tooltip>
                )}
              </Box>
            }
          />
        </Tabs>
      </Box>
      {tab === 0 && <ProjectsDashboard key={dashboardKey} />}
      {tab === 1 && (
        <Box sx={{ px: 3, py: 2, maxWidth: 1600, mx: 'auto' }}>
          {selectedRepo ? (
            <DocsBrowser
              repo={selectedRepo}
              projectId={repoProjectMap[selectedRepo]}
              onBack={() => { setSelectedRepo(null); loadRepos(); }}
              onTasksChanged={() => setDashboardKey(k => k + 1)}
            />
          ) : (
            <Box>
              <Box sx={{ mb: 3 }}>
                <Box component="span" sx={{ typography: 'h4', fontWeight: 700, color: '#00472e' }}>Documentation</Box>
              </Box>
              {docsRepos.length === 0 ? (
                <Box sx={{ p: 4, textAlign: 'center', bgcolor: '#fafafa', borderRadius: 2 }}>
                  <Box component="span" sx={{ typography: 'body1', color: 'text.secondary' }}>No documentation repositories found in docs/</Box>
                </Box>
              ) : (
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {docsRepos.map(repo => (
                    <Box
                      key={repo}
                      onClick={() => setSelectedRepo(repo)}
                      sx={{
                        p: 3, borderRadius: 2, bgcolor: '#fff', border: '1px solid #e0e0e0',
                        cursor: 'pointer', minWidth: 220, transition: 'all 0.2s',
                        '&:hover': { transform: 'translateY(-2px)', boxShadow: 3, borderColor: '#007638' },
                      }}
                    >
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                        <MenuBook sx={{ color: '#007638' }} />
                        <Box component="span" sx={{ typography: 'h6', fontWeight: 700 }}>{repo}</Box>
                      </Box>
                      <Chip
                        size="small"
                        icon={syncStatuses[repo] !== false ? <CloudDone fontSize="small" /> : <SyncProblem fontSize="small" />}
                        label={syncStatuses[repo] !== false ? 'Synced' : 'Out of sync'}
                        color={syncStatuses[repo] !== false ? 'success' : 'warning'}
                        variant="outlined"
                      />
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
      <Snackbar open={!!changeSnack} autoHideDuration={5000} onClose={() => setChangeSnack(null)} anchorOrigin={{ vertical: 'top', horizontal: 'right' }}>
        <Alert severity="info" variant="filled" icon={<FiberNew />} onClose={() => setChangeSnack(null)}>{changeSnack}</Alert>
      </Snackbar>
    </ThemeProvider>
  );
}
