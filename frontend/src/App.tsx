import { ThemeProvider, createTheme, CssBaseline } from '@mui/material';
import ProjectsDashboard from './components/ProjectsDashboard';

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
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <ProjectsDashboard />
    </ThemeProvider>
  );
}
