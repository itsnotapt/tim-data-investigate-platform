import { loadColumnViews, useColumnViewsStore } from '../features/column-views';

/** Bootstrap entry points for column views; the store lives in `features/column-views`. */
export const useColumnViewsState = useColumnViewsStore;
export { loadColumnViews };
