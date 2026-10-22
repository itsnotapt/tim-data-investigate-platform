import Block from '@mui/icons-material/Block';
import BugReportOutlined from '@mui/icons-material/BugReportOutlined';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import FlagOutlined from '@mui/icons-material/FlagOutlined';
import HelpOutlineOutlined from '@mui/icons-material/HelpOutlineOutlined';
import StarBorder from '@mui/icons-material/StarBorder';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import WarningAmber from '@mui/icons-material/WarningAmber';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';
import type { CustomCellRendererProps } from 'ag-grid-react';
import type { ComponentType } from 'react';
import type { LabelSymbol as SymbolName } from '../../lib/api';
import { SkullIcon } from '../grid/SkullIcon';
import { useInstanceStore } from '../instance';
import { shownLabel } from './labels';
import { rowLabelKey } from './labelRows';

/** Height in px of each drawn symbol, the checkbox's height. */
const GLYPH_HEIGHT = 16;

/** Each symbol's icon. `viewBox` is cropped to the glyph, `aspect` is its width over its height. */
const SYMBOLS: Record<
  SymbolName,
  { Icon: ComponentType<SvgIconProps>; viewBox?: string; aspect: number }
> = {
  skull: { Icon: SkullIcon, viewBox: '80 -880 800 800', aspect: 1 },
  warning: { Icon: WarningAmber, viewBox: '1 2 22 19', aspect: 22 / 19 },
  check: { Icon: CheckCircleOutlined, viewBox: '2 2 20 20', aspect: 1 },
  flag: { Icon: FlagOutlined, aspect: 1 },
  star: { Icon: StarBorder, aspect: 1 },
  question: { Icon: HelpOutlineOutlined, viewBox: '2 2 20 20', aspect: 1 },
  block: { Icon: Block, viewBox: '2 2 20 20', aspect: 1 },
  bug: { Icon: BugReportOutlined, aspect: 1 },
  eye: { Icon: VisibilityOutlined, viewBox: '1 4.5 22 15', aspect: 22 / 15 },
};

/** Selection-column cell renderer of action grids: the row's label symbol, beside the checkbox. */
export function LabelSymbol({ node, data }: CustomCellRendererProps) {
  const labels = useInstanceStore((s) => s.instance?.labels);
  const key = rowLabelKey(data);
  if (node.group || key === null) return null;
  const { name, symbol } = shownLabel(key, labels ?? []);
  if (symbol === null) return null;
  const { Icon, viewBox, aspect } = SYMBOLS[symbol];
  return (
    <Tooltip title={name}>
      <Icon
        role="img"
        aria-label={name}
        aria-hidden={false}
        viewBox={viewBox}
        sx={{
          width: GLYPH_HEIGHT * aspect,
          height: GLYPH_HEIGHT,
          color: 'text.primary',
          display: 'block',
        }}
      />
    </Tooltip>
  );
}
