import { createHashRouter } from 'react-router';
import { AppShell } from './AppShell';
import { ExportImportPage, HomePage, QueryManagerPage, ShareQueryPage, ViewPage } from './pages';

// Hash routes mirror the legacy app so existing share links keep working.
export const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'queries', element: <QueryManagerPage /> },
      { path: 'view/:uuid', element: <ViewPage /> },
      { path: 'share/:uuid', element: <ShareQueryPage /> },
      { path: 'exportimport', element: <ExportImportPage /> },
    ],
  },
]);
