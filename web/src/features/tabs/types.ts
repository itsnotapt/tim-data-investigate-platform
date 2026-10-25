/**
 * Tab model. Same shape as the exported/imported JSON; `children` is derived by selectors, never stored.
 * The shapes are shared with the IndexedDB layer (`src/lib/storage`).
 */
import type {
  ActionDisplayComponent,
  ActionParams,
  DisplayComponentName,
  DisplayComponentState,
  KustoQueryDisplayComponent,
  KustoQueryParams,
  ParamErrors,
  StoredError,
} from '../../lib/storage';

export type {
  ActionParams,
  DisplayComponentName as TabKind,
  DisplayComponentState as TabState,
  KustoQueryParams,
  ParamErrors,
  StoredError,
};

type KustoQueryTab = KustoQueryDisplayComponent;
export type ActionTab = ActionDisplayComponent;
/** Discriminated on `componentName`. */
export type Tab = KustoQueryTab | ActionTab;

interface CreateTabInput {
  /** Generated when omitted. */
  componentUuid?: string;
  parentUuid: string | null;
  title: string;
  state?: Partial<DisplayComponentState>;
}
type CreateKustoTabInput = CreateTabInput & {
  componentName: 'KustoQueryResult';
  params: KustoQueryParams;
};
type CreateActionTabInput = CreateTabInput & {
  componentName: 'ActionResult';
  params: ActionParams;
};
export type CreateTabArgs = CreateKustoTabInput | CreateActionTabInput;

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
