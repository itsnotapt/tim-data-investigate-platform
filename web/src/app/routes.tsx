import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { ExportImportPage, QueryManagerPage, ShareQueryPage, ViewPage, Welcome } from './lazyPages';

// Hash routes mirror the legacy app so existing share links keep working.
// Pages are lazy; AppShell provides the Suspense boundary. Unlike legacy, unknown hashes go home.
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
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
