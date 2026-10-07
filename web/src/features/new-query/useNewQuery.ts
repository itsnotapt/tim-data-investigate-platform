import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { getDefaultParams } from '../../lib/kql-templates';
import { defaultNewQuery } from '../kusto-query/defaultQuery';
import { useTabsStore, type TabsStore } from '../tabs';
import type { QueryTemplate } from './types';

const NEW_QUERY_TITLE = 'New query';

export interface NewQueryActions {
  /** New root ad-hoc query with the default KQL; navigates to it. Returns the new uuid. */
  createAdHoc: () => string;
  /** New root template tab in edit mode (not auto-run). */
  createFromTemplate: (template: QueryTemplate) => string;
}

/** Creates tabs from the New menu (W1) and navigates to them. */
export function useNewQuery(store: TabsStore = useTabsStore): NewQueryActions {
  const navigate = useNavigate();
  const createAdHoc = useCallback(() => {
    const uuid = store.getState().createTab({
      componentName: 'KustoQueryResult',
      parentUuid: null,
      title: NEW_QUERY_TITLE,
      params: { query: defaultNewQuery(), cluster: '', database: '' },
    });
    void navigate(`/view/${uuid}`);
    return uuid;
  }, [store, navigate]);

  const createFromTemplate = useCallback(
    (template: QueryTemplate) => {
      // Deep clone: the tab keeps its own snapshot.
      const snapshot = JSON.parse(JSON.stringify(template)) as QueryTemplate;
      const inParams = JSON.parse(JSON.stringify(getDefaultParams(snapshot))) as Record<
        string,
        unknown
      >;
      const uuid = store.getState().createTab({
        componentName: 'TemplateQueryResult',
        parentUuid: null,
        title: template.summary,
        params: { inParams, queryTemplate: snapshot },
        state: { editQuery: true },
      });
      void navigate(`/view/${uuid}`);
      return uuid;
    },
    [store, navigate],
  );
  return { createAdHoc, createFromTemplate };
}
