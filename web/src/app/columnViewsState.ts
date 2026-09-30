import { loadColumnViews, useColumnViewsStore } from '../features/column-views';

/** Bootstrap entry points for column views; the store lives in `features/column-views` (P4-16). */
export const useColumnViewsState = useColumnViewsStore;
export { loadColumnViews };
