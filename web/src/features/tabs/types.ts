/**
 * Tab model. Same shape as the exported/imported JSON; `children` is derived by selectors, never stored.
 * The shapes are shared with the IndexedDB layer (`src/lib/storage`).
 */
import type {
  ActionDisplayComponent,
  ActionParams,
  DisplayComponentName,
  DisplayComponentState,
  ParamErrors,
  StoredError,
} from '../../lib/storage';

export type {
  ActionParams,
  DisplayComponentName as TabKind,
  DisplayComponentState as TabState,
  ParamErrors,
  StoredError,
};

export type ActionTab = ActionDisplayComponent;
export type Tab = ActionTab;

interface CreateTabInput {
  /** Generated when omitted. */
  componentUuid?: string;
  parentUuid: string | null;
  title: string;
  state?: Partial<DisplayComponentState>;
}
export type CreateTabArgs = CreateTabInput & {
  componentName: 'ActionResult';
  params: ActionParams;
};

/** Partial state update. `error` may be anything thrown; it is reduced to `{message, code?}`. */
export type TabStateUpdate = Partial<Omit<DisplayComponentState, 'error'>> & {
  error?: unknown;
};

export const DEFAULT_TAB_STATE: DisplayComponentState = {
  isVisited: false,
  error: null,
  rowCount: null,
  isExecuting: false,
};
