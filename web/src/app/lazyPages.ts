import { lazy } from 'react';

// One chunk per page; AppShell provides the Suspense boundary.
export const Welcome = lazy(() => import('./Welcome'));
export const QueryManagerPage = lazy(() => import('../features/templates-admin/QueryManagerPage'));
export const ViewPage = lazy(() => import('../features/tabs/ViewPage'));
export const ShareQueryPage = lazy(() => import('../features/share/ShareQueryPage'));
export const ExportImportPage = lazy(() => import('../features/export-import/ExportImportPage'));
