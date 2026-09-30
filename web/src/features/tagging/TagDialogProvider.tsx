import { useCallback, useState, type ReactNode } from 'react';
import type { CallOptions } from '../../lib/api';
import { applyRowUpdates } from '../grid';
import type { GridRowWithId } from '../grid';
import { TagDialogContext } from './TagDialogContext';
import type { OpenTagDialog, OpenTagDialogRequest } from './TagDialogContext';
import { TagDialog } from './TagDialog';

interface Open extends OpenTagDialogRequest {
  key: number;
}

/** Owns the single tag dialog; the grid context menu opens it through `TagDialogContext`. */
export function TagDialogProvider({ children, call }: { children: ReactNode; call?: CallOptions }) {
  const [open, setOpen] = useState<Open | null>(null);
  const openDialog = useCallback<OpenTagDialog>((request) => {
    setOpen((prev) => ({ ...request, key: (prev?.key ?? 0) + 1 }));
  }, []);

  return (
    <TagDialogContext.Provider value={openDialog}>
      {children}
      {open && (
        <TagDialog
          key={open.key}
          rows={open.rows}
          call={call}
          onClose={() => setOpen(null)}
          onApply={async (updated) => {
            // Rows keep their client `_id`, so the transaction replaces them (BUG-25).
            await applyRowUpdates(open.api, open.uuid, updated as GridRowWithId[], open.columnId);
            open.api.deselectAll?.();
          }}
        />
      )}
    </TagDialogContext.Provider>
  );
}
