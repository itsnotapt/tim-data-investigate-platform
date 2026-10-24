import { lazy } from 'react';

// One chunk per page; AppShell provides the Suspense boundary.
export const Welcome = lazy(() => import('./Welcome'));
export const QueryManagerPage = lazy(() => import('../features/templates-admin/QueryManagerPage'));
export const ViewPage = lazy(() => import('../features/tabs/ViewPage'));
export const ShareLinkPage = lazy(() => import('../features/share-links/ShareLinkPage'));
