import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import WarningAmber from '@mui/icons-material/WarningAmber';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';
import type { CustomCellRendererProps } from 'ag-grid-react';
import type { ComponentType } from 'react';
import { getDetermination } from './rowClasses';
import type { Determination } from './rowClasses';
import { SkullIcon } from './SkullIcon';

/** Height in px of each drawn symbol, the checkbox's height. */
const GLYPH_HEIGHT = 16;

/**
 * The symbol and accessible name of each determination. `viewBox` is cropped to the glyph, `aspect`
 * is its width over its height.
 */
const SYMBOLS: Record<
  Determination,
  { Icon: ComponentType<SvgIconProps>; label: string; viewBox: string; aspect: number }
> = {
  malicious: { Icon: SkullIcon, label: 'Malicious', viewBox: '80 -880 800 800', aspect: 1 },
  suspicious: { Icon: WarningAmber, label: 'Suspicious', viewBox: '1 2 22 19', aspect: 22 / 19 },
  benign: { Icon: CheckCircleOutlined, label: 'Benign', viewBox: '2 2 20 20', aspect: 1 },
};

/** Selection-column cell renderer: the row's determination symbol, beside the checkbox. */
export function DeterminationSymbol({ node, data }: CustomCellRendererProps) {
  if (node.group) return null;
  const determination = getDetermination(data);
  if (!determination) return null;
  const { Icon, label, viewBox, aspect } = SYMBOLS[determination];
  return (
    <Tooltip title={label}>
      <Icon
        role="img"
        aria-label={label}
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
