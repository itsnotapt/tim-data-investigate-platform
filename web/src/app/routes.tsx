import { Navigate, type RouteObject } from 'react-router';
import { AppShell } from './AppShell';
import { ShareLinkPage, ViewPage, Welcome } from './lazyPages';

// Hash routes. Pages are lazy; AppShell provides the Suspense boundary. Unknown hashes go home.
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <Welcome /> },
      { path: 'view/:uuid', element: <ViewPage /> },
      { path: 'runs/:runId', element: <ShareLinkPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
];
