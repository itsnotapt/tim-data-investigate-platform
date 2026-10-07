/**
 * Tab model. Same shape as the exported/imported JSON; `children` is derived by selectors, never stored.
 * The shapes are shared with the IndexedDB layer (`src/lib/storage`).
 */
import type {
  DisplayComponentName,
  DisplayComponentState,
  KustoQueryDisplayComponent,
  KustoQueryParams,
  StoredError,
  TemplateQueryDisplayComponent,
  TemplateQueryParams,
} from '../../lib/storage';
import type { QueryTemplate } from '../../lib/kql-templates';

export type {
  DisplayComponentName as TabKind,
  DisplayComponentState as TabState,
  KustoQueryParams,
  StoredError,
  TemplateQueryParams,
};

type KustoQueryTab = KustoQueryDisplayComponent;
export type TemplateQueryTab = TemplateQueryDisplayComponent;
/** Discriminated on `componentName`. */
export type Tab = KustoQueryTab | TemplateQueryTab;

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
type CreateTemplateTabInput = CreateTabInput & {
  componentName: 'TemplateQueryResult';
  params: TemplateQueryParams;
};
export type CreateTabArgs = CreateKustoTabInput | CreateTemplateTabInput;

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

/** The template snapshot stored on a template tab, typed for the template engine. */
export function getTabTemplate(tab: TemplateQueryTab): QueryTemplate {
  return tab.params.queryTemplate as unknown as QueryTemplate;
}
