import { theme } from './theme';

/** WCAG 2.x relative luminance of a `#rrggbb` colour. */
function luminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) throw new Error(`Not a 6-digit hex colour: ${hex}`);
  const [r, g, b] = match.slice(1).map((part) => {
    const c = parseInt(part, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('contrast helper', () => {
  it('matches known WCAG ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrast('#1976d2', '#ffffff')).toBeCloseTo(4.6, 1);
  });
});

const TEXT = 4.5;
const NON_TEXT = 3;

describe.each(['light', 'dark'] as const)('%s colour scheme', (scheme) => {
  const palette = theme.colorSchemes[scheme]!.palette;
  /** A palette colour by its token path, e.g. `text.primary`. */
  const colour = (path: string): string => {
    const value = path
      .split('.')
      .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], palette);
    if (typeof value !== 'string') throw new Error(`No palette colour at ${path}`);
    return value;
  };

  it.each([
    ['text.primary', 'background.default', TEXT],
    ['text.primary', 'background.paper', TEXT],
    ['text.secondary', 'background.default', TEXT],
    ['text.secondary', 'background.paper', TEXT],
    ['primary.main', 'background.default', TEXT],
    ['text.primary', 'determination.malicious', TEXT],
    ['text.primary', 'determination.suspicious', TEXT],
    ['text.primary', 'determination.benign', TEXT],
    ['editor.border', 'background.default', NON_TEXT],
  ] as const)('%s on %s meets %s:1', (fg, bg, min) => {
    expect(contrast(colour(fg), colour(bg))).toBeGreaterThanOrEqual(min);
  });

  it('sets contrastThreshold to 4.5 so contained-button labels meet AA', () => {
    expect(palette.contrastThreshold).toBe(4.5);
  });
});

describe('palette values', () => {
  it.each([
    ['light', '#1976d2', '#ffffff', '#212121', '#8a8a8a'],
    ['dark', '#90caf9', '#1e1e1e', '#e0e0e0', '#6e6e6e'],
  ] as const)('%s scheme has the spec colours', (scheme, primary, paper, text, border) => {
    const palette = theme.colorSchemes[scheme]!.palette;
    expect(palette.primary.main).toBe(primary);
    expect(palette.background.paper).toBe(paper);
    expect(palette.text.primary).toBe(text);
    expect(palette.editor.border).toBe(border);
  });

  it('writes the colour scheme on the data-ag-theme-mode attribute AG Grid reads', () => {
    expect(theme.getColorSchemeSelector('dark')).toBe('[data-ag-theme-mode="dark"] &');
  });
});
