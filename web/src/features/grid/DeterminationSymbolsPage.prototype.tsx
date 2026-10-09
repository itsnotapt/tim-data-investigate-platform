// PROTOTYPE (#44): "Where does the toggle for determination symbols live, and how do the symbols
// sit beside the checkbox?" Three variants on /#/prototype/determination-symbols?variant=A|B|C,
// all on the real results grid with tagged rows. Every variant draws the symbols with a 16px-tall
// glyph and a selection column sized to its content. Throwaway: lives on branch
// prototype/determination-symbols only. The toggle is in memory (resets on reload).
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import WarningAmber from '@mui/icons-material/WarningAmber';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import type {
  DefaultMenuItem,
  GetContextMenuItemsParams,
  MenuItemDef,
  SelectionColumnDef,
} from 'ag-grid-community';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { useMemo, useState, type ComponentType } from 'react';
import { PrototypeSwitcher, usePrototypeVariant } from '../../components/PrototypeSwitcher';
import { ResultsGrid } from './ResultsGrid';
import { staticGridOptions } from './gridOptions';
import { getDetermination, type Determination } from './rowClasses';
import { SkullIcon } from './SkullIcon';

const VARIANTS = [
  { key: 'A', name: 'Right-click a checkbox cell' },
  { key: 'B', name: 'Right-click the checkbox header' },
  { key: 'C', name: 'Both' },
] as const;

/** Glyph height in px; each viewBox is cropped to the glyph so the drawn shape is this tall. */
const GLYPH = 16;

const SYMBOLS: Record<
  Determination,
  { Icon: ComponentType<SvgIconProps>; label: string; viewBox: string; aspect: number }
> = {
  malicious: { Icon: SkullIcon, label: 'Malicious', viewBox: '80 -880 800 800', aspect: 1 },
  suspicious: { Icon: WarningAmber, label: 'Suspicious', viewBox: '1 2 22 19', aspect: 22 / 19 },
  benign: { Icon: CheckCircleOutlined, label: 'Benign', viewBox: '2 2 20 20', aspect: 1 },
};

function TightSymbol({ node, data }: CustomCellRendererProps) {
  if (node.group) return null;
  const d = getDetermination(data);
  if (!d) return null;
  const { Icon, label, viewBox, aspect } = SYMBOLS[d];
  return (
    <Tooltip title={label}>
      <Icon
        role="img"
        aria-label={label}
        aria-hidden={false}
        viewBox={viewBox}
        sx={{
          fontSize: GLYPH,
          width: GLYPH * aspect,
          height: GLYPH,
          color: 'text.primary',
          verticalAlign: 'middle',
          display: 'block',
        }}
      />
    </Tooltip>
  );
}

/** Balham (measured): 7px cell padding each side, 16px checkbox, 6px gap, widest symbol (warning). */
const WIDTH_ON = Math.ceil(7 + 16 + 6 + GLYPH * (22 / 19) + 7);
const WIDTH_OFF = 7 + 16 + 7;

const DETS = ['malicious', 'suspicious', 'benign', null, null] as const;
const ROWS = Array.from({ length: 24 }, (_, i) => {
  const det = DETS[i % DETS.length] ?? null;
  return {
    Timestamp: `2026-10-08T12:${String(10 + i).padStart(2, '0')}:00Z`,
    EventId: `evt-${1000 + i}`,
    Computer: ['ws-fin-04', 'srv-dc-01', 'ws-hr-11', 'lap-dev-22'][i % 4],
    Account: ['alice', 'svc_backup', 'bob', 'SYSTEM'][i % 4],
    ProcessName: ['powershell.exe', 'rundll32.exe', 'outlook.exe', 'cmd.exe', 'chrome.exe'][i % 5],
    CommandLine: ['-enc SQBFAFgA…', 'C:\\temp\\x.dll,Start', '/safe', '/c whoami', '--type=renderer'][
      i % 5
    ],
    TagEvent: det
      ? { Determination: det, IsSaved: true, Comment: `${det} per triage`, Tags: [] }
      : { IsSaved: false },
  };
});

export function DeterminationSymbolsPage() {
  const variant = usePrototypeVariant(VARIANTS.map((v) => v.key));
  const [show, setShow] = useState(true);

  const selectionColumnDef = useMemo<SelectionColumnDef>(() => {
    const toggle: MenuItemDef = {
      name: 'Show determination symbols',
      checked: show,
      action: () => setShow((s) => !s),
    };
    const base = staticGridOptions.selectionColumnDef!;
    const cellMenu = variant === 'A' || variant === 'C';
    const headerMenu = variant === 'B' || variant === 'C';
    return {
      ...base,
      cellRenderer: show ? TightSymbol : undefined,
      width: show ? WIDTH_ON : WIDTH_OFF,
      cellStyle: { display: 'flex', alignItems: 'center' },
      ...(cellMenu && {
        contextMenuItems: (_p: GetContextMenuItemsParams): (DefaultMenuItem | MenuItemDef)[] => [
          toggle,
          'separator',
          'copy',
          'copyWithHeaders',
          'export',
        ],
      }),
      ...(headerMenu && {
        suppressHeaderContextMenu: false,
        mainMenuItems: [toggle],
        columnMenuItems: [toggle],
      }),
      ...(!headerMenu && { suppressHeaderContextMenu: true }),
    };
  }, [variant, show]);

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Determination symbols: {VARIANTS.find((v) => v.key === variant)?.name}
      </Typography>
      <ResultsGrid
        key={variant}
        rows={ROWS}
        height={560}
        columnViews={false}
        detailPanel={false}
        selectionColumnDef={selectionColumnDef}
      />
      <PrototypeSwitcher
        variants={VARIANTS}
        state={`symbols ${show ? 'on' : 'off'} · column ${show ? WIDTH_ON : WIDTH_OFF}px`}
      />
    </Box>
  );
}
