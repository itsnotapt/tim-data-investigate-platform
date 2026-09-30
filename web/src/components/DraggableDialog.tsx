import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import Dialog, { type DialogProps } from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';

export interface DraggableDialogProps extends Omit<DialogProps, 'title'> {
  title: ReactNode;
  actions?: ReactNode;
}

interface Offset {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  startOffset: Offset;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

/**
 * MUI Dialog draggable by its title bar, kept inside the viewport. Uses pointer events (with
 * pointer capture) and a single window resize listener; no polling (legacy used a 100 ms
 * interval, BUG-37).
 */
export function DraggableDialog({
  title,
  actions,
  children,
  slotProps,
  ...dialogProps
}: DraggableDialogProps) {
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const paperRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<DragState | null>(null);
  const offsetRef = useRef(offset);

  /** Clamp a desired offset so the paper stays fully inside the viewport. */
  const clampOffset = useCallback((desired: Offset, current: Offset): Offset => {
    const paper = paperRef.current;
    if (!paper) return desired;
    const rect = paper.getBoundingClientRect();
    const baseLeft = rect.left - current.x;
    const baseTop = rect.top - current.y;
    return {
      x: clamp(
        desired.x,
        -baseLeft,
        Math.max(-baseLeft, window.innerWidth - rect.width - baseLeft),
      ),
      y: clamp(desired.y, -baseTop, Math.max(-baseTop, window.innerHeight - rect.height - baseTop)),
    };
  }, []);

  const apply = useCallback((next: Offset) => {
    offsetRef.current = next;
    setOffset(next);
  }, []);

  useEffect(() => {
    if (!dialogProps.open) return;
    const onResize = () => apply(clampOffset(offsetRef.current, offsetRef.current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [dialogProps.open, apply, clampOffset]);

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0) return;
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startOffset: offsetRef.current,
    };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    apply(
      clampOffset(
        { x: d.startOffset.x + e.clientX - d.startX, y: d.startOffset.y + e.clientY - d.startY },
        offsetRef.current,
      ),
    );
  };

  const endDrag = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.pointerId !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const userPaper = slotProps?.paper;
  const paperProps = typeof userPaper === 'object' ? userPaper : undefined;

  return (
    <Dialog
      {...dialogProps}
      slotProps={{
        ...slotProps,
        paper: {
          ...paperProps,
          ref: paperRef,
          style: {
            ...paperProps?.style,
            transform: `translate(${offset.x}px, ${offset.y}px)`,
          },
        } as NonNullable<DialogProps['slotProps']>['paper'],
      }}
    >
      <DialogTitle
        data-testid="draggable-dialog-title"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        sx={{ cursor: 'move', touchAction: 'none', userSelect: 'none' }}
      >
        {title}
      </DialogTitle>
      <DialogContent>{children}</DialogContent>
      {actions && <DialogActions>{actions}</DialogActions>}
    </Dialog>
  );
}
