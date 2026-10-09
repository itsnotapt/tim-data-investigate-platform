// PROTOTYPE (wayfinder #40): "What should the light and dark palettes look like, including
// determination colours?" Three palette variants on /#/prototype/palettes?variant=A|B|C, inside
// the real AppShell (Settings › Theme switches Light / Dark / System). Shows the real results
// grid with tagged rows, the KQL and YAML editors, common MUI controls, and live WCAG checks for
// both schemes. Throwaway: lives on branch prototype/palettes only.
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Paper from '@mui/material/Paper';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import { useEffect, useState } from 'react';
import { CodeEditor } from '../components/CodeEditor';
import { PrototypeSwitcher, usePrototypeVariant } from '../components/PrototypeSwitcher';
import { ResultsGrid } from '../features/grid';
import {
  checksFor,
  contrast,
  CVD,
  PALETTES,
  simulate,
  usePaletteStore,
  type PaletteVariant,
  type SchemePalette,
} from './palettes.prototype';

const KEYS = ['A', 'B', 'C'] as const;

const DETS = ['Malicious', 'Suspicious', 'Benign', null, null] as const;
const ROWS = Array.from({ length: 16 }, (_, i) => {
  const det = DETS[i % DETS.length] ?? null;
  return {
    Timestamp: `2026-10-08T12:${String(10 + i).padStart(2, '0')}:00Z`,
    EventId: `evt-${1000 + i}`,
    Computer: ['ws-fin-04', 'srv-dc-01', 'ws-hr-11', 'lap-dev-22'][i % 4],
    Account: ['alice', 'svc_backup', 'bob', 'SYSTEM'][i % 4],
    ProcessName: ['powershell.exe', 'rundll32.exe', 'outlook.exe', 'cmd.exe', 'chrome.exe'][i % 5],
    CommandLine: [
      '-enc SQBFAFgA…',
      'C:\\temp\\x.dll,Start',
      '/safe',
      '/c whoami',
      '--type=renderer',
    ][i % 5],
    TagEvent: det
      ? { Determination: det.toLowerCase(), IsSaved: true, Comment: `${det} per triage`, Tags: [] }
      : { IsSaved: false },
  };
});

const KQL = `// Process events for a host, last day
DeviceProcessEvents
| where Timestamp > ago(1d) and DeviceName == "ws-fin-04"
| where ProcessCommandLine has_any ("-enc", "rundll32")
| summarize Count = count(), First = min(Timestamp) by AccountName, FileName
| order by Count desc
| take 100`;

const YAML = `name: Suspicious process
description: Encoded PowerShell on a host
query: |
  DeviceProcessEvents
  | where ProcessCommandLine has "-enc"
columnId: EventId
`;

const editorBox = { border: '1px dotted var(--mui-palette-tim-border)', height: 200 } as const;

function Ratio({ value, min }: { value: number; min: number | null }) {
  const ok = min === null || value >= min;
  return (
    <Box component="span" sx={{ fontFamily: 'monospace', fontWeight: ok ? 400 : 700 }}>
      {value.toFixed(2)}
      {min !== null && (
        <Box component="span" sx={{ color: ok ? 'success.main' : 'error.main', ml: 0.5 }}>
          {ok ? '✓' : `✗ <${min}`}
        </Box>
      )}
    </Box>
  );
}

function Swatch({ fg, bg }: { fg: string; bg: string }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-block',
        px: 0.75,
        mr: 1,
        bgcolor: bg,
        color: fg,
        border: '1px solid',
        borderColor: 'divider',
        fontSize: 12,
      }}
    >
      Aa
    </Box>
  );
}

function SchemeChecks({
  title,
  p,
  buttonText,
}: {
  title: string;
  p: SchemePalette;
  buttonText: string;
}) {
  const checks = checksFor(p, buttonText);
  const failing = checks.filter((c) => c.min !== null && contrast(c.fg, c.bg) < c.min).length;
  return (
    <Paper variant="outlined" sx={{ p: 1.5, flex: 1, minWidth: 320 }}>
      <Typography variant="subtitle2">
        {title}: {failing === 0 ? 'all AA checks pass' : `${failing} AA failure(s)`}
      </Typography>
      <Box component="table" sx={{ fontSize: 13, borderSpacing: '8px 2px', ml: -1 }}>
        <tbody>
          {checks.map((c) => (
            <tr key={c.label}>
              <td>
                <Swatch fg={c.fg} bg={c.bg} />
                {c.label}
              </td>
              <td>
                <Ratio value={contrast(c.fg, c.bg)} min={c.min} />
              </td>
            </tr>
          ))}
        </tbody>
      </Box>
      <Typography variant="subtitle2" sx={{ mt: 1 }}>
        Determination rows under colour-vision deficiency (row text on fill)
      </Typography>
      {Object.entries(CVD).map(([name, m]) => (
        <Box
          key={name}
          sx={{ display: 'flex', alignItems: 'center', gap: 0.5, fontSize: 12, mt: 0.5 }}
        >
          <Box sx={{ width: 52 }}>{name}</Box>
          {[
            p.paper,
            p.determination.malicious,
            p.determination.suspicious,
            p.determination.benign,
          ].map((c, i) => (
            <Box
              key={i}
              sx={{
                width: 84,
                py: 0.25,
                px: 0.5,
                bgcolor: simulate(c, m),
                color: simulate(p.text, m),
                border: '1px solid',
                borderColor: 'divider',
                boxShadow:
                  i > 0
                    ? `inset 5px 0 0 ${simulate(Object.values(p.stripe)[i - 1]!, m)}`
                    : undefined,
                pl: 1,
              }}
            >
              {['untagged', 'malicious', 'suspicious', 'benign'][i]}
            </Box>
          ))}
        </Box>
      ))}
    </Paper>
  );
}

export function PalettesPage() {
  const variant = usePrototypeVariant(KEYS) as PaletteVariant['key'];
  const setVariant = usePaletteStore((s) => s.setVariant);
  useEffect(() => setVariant(variant), [variant, setVariant]);
  const { mode, colorScheme } = useColorScheme();
  const [tab, setTab] = useState(0);
  const [kql, setKql] = useState(KQL);
  const v = PALETTES[variant];
  // MUI picks white when it reaches contrastThreshold (4.5), else near-black.
  const btn = (s: 'light' | 'dark') =>
    contrast('#ffffff', v[s].primary) >= 4.5 ? '#ffffff' : '#000000';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pb: 8 }}>
      <Paper
        variant="outlined"
        sx={{ p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}
      >
        <Typography variant="h6" sx={{ mr: 2 }}>
          Palette {v.key}: {v.name}
        </Typography>
        <Button variant="contained">Run query</Button>
        <Button variant="outlined">Save</Button>
        <Button>Cancel</Button>
        <Button variant="contained" color="error">
          Delete
        </Button>
        <TextField size="small" label="Quick UI filter" defaultValue="powershell" />
        <Chip label="malicious" size="small" />
        <Link href="#/prototype/palettes">A link</Link>
        <Typography variant="body2" color="text.secondary">
          Secondary text: 16 rows, 0.42 s
        </Typography>
      </Paper>

      <Box sx={{ display: 'flex', gap: 1 }}>
        <Alert severity="info" variant="outlined" sx={{ flex: 1 }}>
          You must sign-in first.
        </Alert>
        <Alert severity="error" variant="outlined" sx={{ flex: 1 }}>
          Kusto returned 503.
        </Alert>
        <Alert severity="success" sx={{ flex: 1 }}>
          Tagged 3 events as malicious.
        </Alert>
      </Box>

      <Paper variant="outlined">
        <Tabs
          value={tab}
          onChange={(_, t: number) => setTab(t)}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab label="Suspicious process" />
          <Tab label="Ad hoc KQL" />
          <Tab label="Logons" />
        </Tabs>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          <ResultsGrid rows={ROWS} height={420} columnViews={false} stateKey="prototype-palettes" />
        </Box>
      </Paper>

      <Box sx={{ display: 'flex', gap: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2">KQL editor (ad hoc query)</Typography>
          <Box sx={editorBox}>
            <CodeEditor
              value={kql}
              onChange={setKql}
              language="kusto"
              path="proto-kql"
              ariaLabel="KQL"
            />
          </Box>
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography variant="subtitle2">YAML editor (Query Manager)</Typography>
          <Box sx={editorBox}>
            <CodeEditor value={YAML} language="yaml" path="proto-yaml.yaml" ariaLabel="YAML" />
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <SchemeChecks title="Light" p={v.light} buttonText={btn('light')} />
        <SchemeChecks title="Dark" p={v.dark} buttonText={btn('dark')} />
      </Box>

      <PrototypeSwitcher
        variants={KEYS.map((k) => ({ key: k, name: PALETTES[k].name }))}
        state={`mode=${mode} scheme=${colorScheme} (Settings › Theme)`}
      />
    </Box>
  );
}
