import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useNotify } from '../../components/useNotify';
import { useTabsStore } from '../tabs/tabStore';
import { buildShareUrl } from '../share/shareLink';
import { cloneTemplateTab, convertTemplateTab, runTemplateQuery } from './runTemplateQuery';

/**
 * Toolbar actions for `TemplateQueryTab`.
 */

/** `runTemplateQuery(uuid)` (no time range) plus the "Executing query..." snackbar. */
export function useRunTemplateQuery(): (uuid: string) => void {
  const notify = useNotify();
  return useCallback(
    (uuid) => {
      notify('Executing query...');
      void runTemplateQuery(uuid);
    },
    [notify],
  );
}

/** Clone as a sibling titled "Copy of <title>", same parent, not auto-run. */
export function useCloneTemplateQuery(): (uuid: string) => void {
  const navigate = useNavigate();
  return useCallback(
    (uuid) => {
      const copy = cloneTemplateTab(uuid);
      if (copy) void navigate(`/view/${copy}`);
    },
    [navigate],
  );
}

/** Convert to a custom `KustoQueryResult` with the rendered KQL (after the confirm dialog). */
export function useConvertTemplateQuery(): (uuid: string) => void {
  return useCallback((uuid) => {
    convertTemplateTab(uuid);
  }, []);
}

/** Copy a share link (`execute=0`) and show the snackbar. */
export function useShareTemplateQuery(): (uuid: string) => void {
  const notify = useNotify();
  return useCallback(
    (uuid) => {
      const tab = useTabsStore.getState().tabs[uuid];
      if (tab?.componentName !== 'TemplateQueryResult') return;
      const id = tab.params.queryTemplate['uuid'];
      const templateUuid = typeof id === 'string' ? id : '';
      const url = buildShareUrl(templateUuid, tab.params.inParams);
      navigator.clipboard.writeText(url).then(
        () => notify('Shared link has been saved to the clipboard.'),
        () => notify('Could not copy the shared link to the clipboard.'),
      );
    },
    [notify],
  );
}
