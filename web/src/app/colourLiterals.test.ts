// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/** CSS named colours (CSS Color 4), lower case. `transparent` and `currentColor` are allowed. */
const NAMED_COLOURS = new Set(
  `aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet
  brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan
  darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta
  darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue
  darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey
  dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray
  green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush
  lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen
  lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey
  lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise
  mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive
  olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred
  papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue
  saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray
  slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white
  whitesmoke yellow yellowgreen`.split(/\s+/),
);

/** Blanks out comments before scanning. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\])\/\/.*$/gm, '$1');
}

/** Text a colour name could be a style value in: CSS declarations, or TS string literals. */
function styleText(source: string, kind: 'css' | 'ts'): string[] {
  if (kind === 'css') return [source];
  return [...source.matchAll(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`/g)].map(
    ([literal]) => literal,
  );
}

/** Colour literals in a source file: hex, `rgb(` / `hsl(` (and `a` forms), named colours. */
function findColourLiterals(source: string, kind: 'css' | 'ts'): string[] {
  const code = stripComments(source);
  const found = [
    ...[...code.matchAll(/#[0-9a-f]{3,8}\b/gi)].map(([m]) => m),
    ...[...code.matchAll(/\b(?:rgba?|hsla?)\(/gi)].map(([m]) => m),
  ];
  for (const text of styleText(code, kind)) {
    // A palette token path (`grey.500`, `common.white`), a CSS custom property (`--x-red`) or a
    // module path (`@azure/msal-react`) isn't a colour value.
    for (const [, word] of text.matchAll(/(?<![\w.@/-])([a-z]+)(?![\w./-])/gi)) {
      if (word && NAMED_COLOURS.has(word.toLowerCase())) found.push(word);
    }
  }
  return found;
}

describe('findColourLiterals', () => {
  it.each([
    ['color: #fff;', 'css', '#fff'],
    ["sx={{ color: '#1976d2' }}", 'ts', '#1976d2'],
    ["background: 'rgb(0, 0, 0)'", 'ts', 'rgb('],
    ['border-color: hsla(0, 0%, 0%, 0.5);', 'css', 'hsla('],
    ["border: '1px dotted darkgrey'", 'ts', 'darkgrey'],
    ["style={{ color: 'red' }}", 'ts', 'red'],
    ['.x { color: White; }', 'css', 'White'],
  ] as const)('finds a literal in %s', (source, kind, literal) => {
    expect(findColourLiterals(source, kind)).toEqual([literal]);
  });

  it.each([
    ["sx={{ bgcolor: 'grey.500', color: 'common.white' }}", 'ts'],
    ["sx={{ color: 'transparent', borderColor: 'currentColor', fill: 'inherit' }}", 'ts'],
    ['.x { color: var(--mui-palette-text-primary); }', 'css'],
    ['/** Spinner, red alert. */ const n = 1; // logs error #200', 'ts'],
    ["const url = 'https://example.com/a#b';", 'ts'],
    ["import { MsalProvider } from '@azure/msal-react';", 'ts'],
    ['const white = isOn; red();', 'ts'],
  ] as const)('ignores %s', (source, kind) => {
    expect(findColourLiterals(source, kind)).toEqual([]);
  });
});

const SRC = join(import.meta.dirname, '..');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!/\.(css|ts|tsx)$/.test(entry.name)) return [];
    if (/\.test\.tsx?$|\.d\.ts$/.test(entry.name)) return [];
    if (path === join(SRC, 'app', 'theme.ts')) return [];
    return [path];
  });
}

/** Test helpers (`src/test/`, `test-setup.ts`) aren't app code. */
const files = sourceFiles(SRC).filter(
  (path) => !/^test[/\\]|^test-setup\.ts$/.test(relative(SRC, path)),
);

describe('colours come from the theme palette', () => {
  it('scans the app sources', () => {
    expect(files.map((path) => relative(SRC, path))).toContain(
      join('features', 'grid', 'grid.css'),
    );
  });

  it.each(files.map((path) => [relative(SRC, path), path]))(
    '%s has no colour literal',
    (_, path) => {
      const kind = path.endsWith('.css') ? 'css' : 'ts';
      expect(findColourLiterals(readFileSync(path, 'utf8'), kind)).toEqual([]);
    },
  );
});
