import { useColumnViewsState } from '../app/columnViewsState';
import { useInstanceStore } from '../features/instance';
import { useTabsStore } from '../features/tabs';
import { useTemplatesStore } from '../features/templates';

/** Makes the app bootstrap instant and storage/network free for tests that render the shell. */
export function stubBootstrap(): void {
  useInstanceStore.setState({
    instance: {
      version: 'test',
      actions: [],
      connections: [],
      labels: [],
      limits: {
        maxResultRows: 1,
        maxResultBytes: 1,
        maxPivotRows: 100,
        rowsPageSize: 1,
        runTimeoutSeconds: 1,
        maxAnnotationIds: 10_000,
        annotationPollSeconds: 30,
      },
    },
  });
  useTemplatesStore.setState({ loaded: true });
  useColumnViewsState.setState({ load: () => Promise.resolve() });
  useTabsStore.setState({ load: () => Promise.resolve(useTabsStore.setState({ loaded: true })) });
}
