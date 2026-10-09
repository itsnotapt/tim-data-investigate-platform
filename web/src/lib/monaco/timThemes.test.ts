import { describe, expect, it } from 'vitest';
import { theme } from '../../app/theme';
import { buildTimTheme } from './timThemes';

const light = theme.colorSchemes.light!.palette;
const dark = theme.colorSchemes.dark!.palette;

describe('buildTimTheme', () => {
  it('builds tim-light on vs and tim-dark on vs-dark, both inheriting', () => {
    expect(buildTimTheme(light)).toMatchObject({ base: 'vs', inherit: true });
    expect(buildTimTheme(dark)).toMatchObject({ base: 'vs-dark', inherit: true });
  });

  it('takes the editor colours from the palette', () => {
    expect(buildTimTheme(dark).colors).toMatchObject({
      'editor.background': '#1e1e1e',
      'editor.foreground': '#e0e0e0',
      'editorLineNumber.foreground': '#a0a0a0',
      'editor.lineHighlightBackground': '#232323',
      'editorWidget.border': '#6e6e6e',
    });
    expect(buildTimTheme(light).colors).toMatchObject({
      'editor.background': '#ffffff',
      'editor.foreground': '#212121',
      'editorLineNumber.foreground': '#616161',
      'editor.lineHighlightBackground': '#fcfdfe',
      'editorWidget.border': '#8a8a8a',
    });
  });

  it('outputs 6-digit hex colours only', () => {
    for (const palette of [light, dark]) {
      const data = buildTimTheme(palette, [{ token: 'comment', foreground: '#608B4E' }]);
      for (const colour of Object.values(data.colors)) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
      for (const rule of data.rules) expect(rule.foreground).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it('keeps the Kusto token rules it is given, with plain text in text.primary', () => {
    const kusto = [
      { token: '', foreground: '#DCDCDC' },
      { token: 'plainText', foreground: '#DCDCDC' },
      { token: 'comment', foreground: '#608B4E' },
      { token: 'queryOperator', foreground: '#FF8C00', fontStyle: 'bold' },
    ];
    const { rules } = buildTimTheme(dark, kusto);
    expect(rules).toEqual([
      { token: '', foreground: '#e0e0e0' },
      { token: 'plainText', foreground: '#e0e0e0' },
      { token: 'comment', foreground: '#608B4E' },
      { token: 'queryOperator', foreground: '#FF8C00', fontStyle: 'bold' },
    ]);
  });

  it('has no token rules without Kusto rules', () => {
    expect(buildTimTheme(light).rules).toEqual([]);
  });
});
