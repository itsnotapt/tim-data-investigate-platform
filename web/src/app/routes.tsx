import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { GridTaggingPage } from '../features/grid-tagging/GridTaggingPage.prototype';
import { ExportImportPage, QueryManagerPage, ShareQueryPage, ViewPage, Welcome } from './lazyPages';

// Hash routes. Pages are lazy; AppShell provides the Suspense boundary. Unknown hashes go home.
export const routes: RouteObject[] = [
  // PROTOTYPE (wayfinder: Tagging in the grid): outside AppShell so it runs without an API.
  { path: '/prototype/grid-tagging', element: <GridTaggingPage /> },
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Welcome /> },
      { path: 'queries', element: <QueryManagerPage /> },
      { path: 'view/:uuid', element: <ViewPage /> },
      { path: 'share/:uuid', element: <ShareQueryPage /> },
      { path: 'exportimport', element: <ExportImportPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
