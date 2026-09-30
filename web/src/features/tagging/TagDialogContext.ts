import { createContext, useContext } from 'react';
import type { GridRowWithId } from '../grid';

/** What the grid context menu hands to the dialog. */
export interface OpenTagDialogRequest {
  rows: readonly GridRowWithId[];
  /** Grid api the updated rows are applied to on success. */
  api: { applyTransaction(tx: { update: GridRowWithId[] }): unknown; deselectAll?(): void };
  /** Tab whose stored rows are rewritten. */
  uuid: string;
  columnId?: string | null;
}

export type OpenTagDialog = (request: OpenTagDialogRequest) => void;

/** `null` outside a `TagDialogProvider` (the "Customise tag events" item is then disabled). */
export const TagDialogContext = createContext<OpenTagDialog | null>(null);

export const useOpenTagDialog = (): OpenTagDialog | null => useContext(TagDialogContext);
