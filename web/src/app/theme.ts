import { buildTheme, PALETTES } from './palettes.prototype';

// PROTOTYPE (wayfinder #40): App builds the theme from the selected palette variant; this default
// keeps other importers working.
export const theme = buildTheme(PALETTES.A);
