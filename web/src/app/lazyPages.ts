import { lazy } from 'react';

// One chunk per page; AppShell provides the Suspense boundary.
export const Welcome = lazy(() => import('./Welcome'));
export const QueryManagerPage = lazy(() => import('../features/templates-admin/QueryManagerPage'));
export const ViewPage = lazy(() => import('../features/tabs/ViewPage'));
export const RunLinkPage = lazy(() => import('../features/run-links/RunLinkPage'));
