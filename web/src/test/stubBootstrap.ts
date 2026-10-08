import { useColumnViewsState } from '../app/columnViewsState';
import { useTabsStore } from '../features/tabs';
import { useTemplatesStore } from '../features/templates';

/** Makes the app bootstrap instant and storage/network free for tests that render the shell. */
export function stubBootstrap(): void {
  useTemplatesStore.setState({ loaded: true });
  useColumnViewsState.setState({ load: () => Promise.resolve() });
  useTabsStore.setState({ load: () => Promise.resolve(useTabsStore.setState({ loaded: true })) });
}
