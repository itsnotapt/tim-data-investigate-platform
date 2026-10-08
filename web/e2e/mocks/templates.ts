import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import type { ApiHandler } from './api';
import { json, problem } from './api';
import { templates as baseTemplates, type MockTemplate } from './data';

export const STORM_UUID = '11111111-1111-1111-1111-111111111111';

/** Share-link payload: base64url of the UTF-8 JSON params. */
export const shareParams = (params: object): string =>
  Buffer.from(JSON.stringify(params), 'utf8').toString('base64url');

/** Opens the storm template through a share link with execute=1. */
export async function openRunTemplateTab(page: Page, state = 'TEXAS'): Promise<void> {
  await page.goto(`/#/share/${STORM_UUID}?p=${shareParams({ State: state })}&execute=1`);
  await expect(page.locator('.ag-row').first()).toBeVisible();
  await expect(page).toHaveURL(/#\/view\//);
}

// ---- Query Manager: a small stateful template store behind /api/templates/queries ----

const DELETED_TEMPLATE: MockTemplate = {
  uuid: '44444444-4444-4444-4444-444444444444',
  name: 'Deleted query',
  isDeleted: true,
  isManaged: false,
  updated: '2026-07-28T10:00:00.000Z',
  createdBy: 'analyst@contoso.com',
  updatedBy: 'analyst@contoso.com',
  queryType: 'query',
  menu: 'Deleted',
  summary: 'Deleted',
  path: ['Archive'],
  cluster: 'help',
  database: 'Samples',
  columnId: null,
  params: {},
  fields: { EventId: { type: 'single' } },
  columns: {},
  query: 'StormEvents | take 1',
};

/** Handlers honouring includeDeleted, DELETE (soft), PATCH (restore), POST and PUT. */
export function templateStoreHandlers(): {
  handlers: ApiHandler[];
  state: MockTemplate[];
  /** Restore the initial templates; call from `beforeEach` (tests in a worker share the module). */
  reset: () => void;
} {
  const initial = (): MockTemplate[] => [...baseTemplates, DELETED_TEMPLATE].map((t) => ({ ...t }));
  const state: MockTemplate[] = initial();
  const BASE = '/api/templates/queries';
  const handlers: ApiHandler[] = [
    (route, call) => {
      if (!call.path.startsWith(BASE)) return false;
      const uuid = call.path.slice(BASE.length + 1);
      if (call.method === 'GET' && uuid === '') {
        const all = call.search.includes('includeDeleted=true');
        void json(route, all ? state : state.filter((t) => !t.isDeleted));
        return true;
      }
      const found = state.find((t) => t.uuid === uuid);
      if (call.method === 'POST' && uuid === '') {
        const body = call.body as Partial<MockTemplate>;
        const created = {
          ...DELETED_TEMPLATE,
          ...body,
          isDeleted: false,
          uuid: '55555555-5555-5555-5555-555555555555',
          updated: '2026-09-29T10:00:00.000Z',
        } as MockTemplate;
        state.push(created);
        void json(route, created, 201);
        return true;
      }
      if (!found) {
        void problem(route, 404, 'not-found', 'Not found');
        return true;
      }
      if (call.method === 'DELETE') {
        found.isDeleted = true;
        void route.fulfill({ status: 204 });
      } else if (call.method === 'PATCH') {
        found.isDeleted = false;
        void json(route, found);
      } else if (call.method === 'PUT') {
        Object.assign(found, call.body as object);
        void json(route, found);
      } else {
        void json(route, found);
      }
      return true;
    },
  ];
  return {
    handlers,
    state,
    reset: () => {
      state.splice(0, state.length, ...initial());
    },
  };
}
