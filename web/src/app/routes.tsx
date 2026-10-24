import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { QueryManagerPage, RunLinkPage, ViewPage, Welcome } from './lazyPages';

// Hash routes. Pages are lazy; AppShell provides the Suspense boundary. Unknown hashes go home.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Welcome /> },
      { path: 'queries', element: <QueryManagerPage /> },
      { path: 'view/:uuid', element: <ViewPage /> },
      { path: 'runs/:runId', element: <RunLinkPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
