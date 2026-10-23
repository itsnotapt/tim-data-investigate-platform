import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import type { ICellRendererParams } from 'ag-grid-community';

/** A comments cell: an icon and the count, when there are any. */
export function CommentsCell({ value }: Partial<ICellRendererParams>) {
  const n = typeof value === 'number' ? value : 0;
  if (n === 0) return null;
  return (
    <span className="tim-comments-cell" aria-label={`${n} ${n === 1 ? 'comment' : 'comments'}`}>
      <ChatBubbleOutlineIcon fontSize="inherit" />
      {n}
    </span>
  );
}
