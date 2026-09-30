import { createTheme } from '@mui/material/styles';

// Legacy (Vuetify light) look, from screenshots 01-04: white dense toolbar with a 1px hairline
// border and no shadow, Vuetify default blue primary, Roboto.
export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#1976d2' },
    background: { default: '#ffffff' },
    text: { primary: 'rgba(0,0,0,0.87)' },
  },
  typography: { fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: { backgroundColor: '#fff', borderBottom: '1px solid rgba(0,0,0,0.1)' },
      },
    },
    MuiToolbar: { defaultProps: { variant: 'dense' } },
  },
});
