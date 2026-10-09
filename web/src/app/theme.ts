import { createTheme } from '@mui/material/styles';

// PROTOTYPE (wayfinder #38): rough light + dark colour schemes so the theme-mode menu
// variants switch something real. Palettes are placeholders; #40 decides the real ones.
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: '#1976d2' },
        background: { default: '#ffffff', paper: '#ffffff' },
        text: { primary: 'rgba(0,0,0,0.87)' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#90caf9' },
        background: { default: '#121212', paper: '#1e1e1e' },
      },
    },
  },
  typography: { fontFamily: 'Roboto, "Helvetica Neue", Arial, sans-serif' },
  components: {
    MuiAppBar: {
      defaultProps: { elevation: 0, color: 'inherit' },
      styleOverrides: {
        root: ({ theme }) => ({
          backgroundColor: theme.vars.palette.background.paper,
          borderBottom: `1px solid ${theme.vars.palette.divider}`,
        }),
      },
    },
    MuiToolbar: { defaultProps: { variant: 'dense' } },
  },
});
