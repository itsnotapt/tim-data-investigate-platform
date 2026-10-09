import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { DeterminationSymbolsPage } from '../features/grid/DeterminationSymbolsPage.prototype';
import { ExportImportPage, QueryManagerPage, ShareQueryPage, ViewPage, Welcome } from './lazyPages';

// Hash routes. Pages are lazy; AppShell provides the Suspense boundary. Unknown hashes go home.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Welcome /> },
      { path: 'queries', element: <QueryManagerPage /> },
      { path: 'view/:uuid', element: <ViewPage /> },
      { path: 'share/:uuid', element: <ShareQueryPage /> },
      { path: 'exportimport', element: <ExportImportPage /> },
      // PROTOTYPE (#44)
      { path: 'prototype/determination-symbols', element: <DeterminationSymbolsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
