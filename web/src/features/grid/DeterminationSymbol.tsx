import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import WarningAmber from '@mui/icons-material/WarningAmber';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import Tooltip from '@mui/material/Tooltip';
import type { CustomCellRendererProps } from 'ag-grid-react';
import type { ComponentType } from 'react';
import { getDetermination } from './rowClasses';
import type { Determination } from './rowClasses';
import { SkullIcon } from './SkullIcon';

/** The symbol and accessible name of each determination. */
const SYMBOLS: Record<Determination, { Icon: ComponentType<SvgIconProps>; label: string }> = {
  malicious: { Icon: SkullIcon, label: 'Malicious' },
  suspicious: { Icon: WarningAmber, label: 'Suspicious' },
  benign: { Icon: CheckCircleOutlined, label: 'Benign' },
};

/** Selection-column cell renderer: the row's determination symbol, beside the checkbox. */
export function DeterminationSymbol({ node, data }: CustomCellRendererProps) {
  if (node.group) return null;
  const determination = getDetermination(data);
  if (!determination) return null;
  const { Icon, label } = SYMBOLS[determination];
  return (
    <Tooltip title={label}>
      <Icon
        role="img"
        aria-label={label}
        aria-hidden={false}
        sx={{ fontSize: 16, color: 'text.primary', verticalAlign: 'middle' }}
      />
    </Tooltip>
  );
}
