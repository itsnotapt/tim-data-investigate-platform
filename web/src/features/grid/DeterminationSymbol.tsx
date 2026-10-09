import type { SvgIconComponent } from '@mui/icons-material';
import CheckCircleOutlined from '@mui/icons-material/CheckCircleOutlined';
import GppBad from '@mui/icons-material/GppBad';
import WarningAmber from '@mui/icons-material/WarningAmber';
import Tooltip from '@mui/material/Tooltip';
import type { CustomCellRendererProps } from 'ag-grid-react';
import { getDetermination } from './rowClasses';
import type { Determination } from './rowClasses';

/** One shape per determination, so a row's determination can be read without its colour. */
const SYMBOLS: Record<Determination, { Icon: SvgIconComponent; label: string }> = {
  malicious: { Icon: GppBad, label: 'Malicious' },
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
        fontSize="small"
        sx={{ color: 'text.primary', verticalAlign: 'middle' }}
      />
    </Tooltip>
  );
}
