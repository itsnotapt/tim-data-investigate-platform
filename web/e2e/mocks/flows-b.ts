import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import { expect } from '../fixtures';
import type { ApiHandler } from './api';
import { json, problem } from './api';
import { templates as baseTemplates, type MockTemplate } from './data';

export const STORM_UUID = '11111111-1111-1111-1111-111111111111';

/** Legacy-style share payload (plain base64 of the JSON params). */
export const shareParams = (params: object): string =>
  encodeURIComponent(Buffer.from(JSON.stringify(params)).toString('base64'));

/** Opens the storm template through a share link with execute=1. */
export async function openRunTemplateTab(page: Page, state = 'TEXAS'): Promise<void> {
  await page.goto(`/#/share/${STORM_UUID}?p=${shareParams({ State: state })}&execute=1`);
  await expect(page.locator('.ag-row').first()).toBeVisible();
  await expect(page).toHaveURL(/#\/view\//);
}

/** Hovers the side tree so it expands (legacy screen 16 / 27). */
export async function expandTree(page: Page): Promise<void> {
  await page.getByLabel('Query tree').hover();
  await expect(page.getByRole('checkbox').first()).toBeVisible();
}

// ---- W12 Query Manager: a small stateful template store behind /api/templates/queries ----

export const DELETED_TEMPLATE: MockTemplate = {
  uuid: '44444444-4444-4444-4444-444444444444',
  name: 'Old deleted query',
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

/**
 * Like `shot()` but leaves the mouse where it is: for states that only exist while hovering
 * (the expanded side tree, legacy screen 16). Same directory and E2E_SHOTS gate as shot.ts.
 */
export async function shotHovering(page: Page, name: string): Promise<void> {
  if (process.env['E2E_SHOTS'] !== '1') return;
  await page.waitForTimeout(500);
  await page.screenshot({
    path: resolve(import.meta.dirname, '../../../docs/rewrite/screenshots', `${name}.png`),
  });
}
