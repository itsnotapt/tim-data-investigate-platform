import 'fake-indexeddb/auto';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import { displayComponentsDao, resetTimDb, rowResultsDao } from '../../lib/storage';
import { useTabsStore } from '../tabs';
import ExportImportPage from './ExportImportPage';
import { parseImport } from './exportImport';

function Titles() {
  const tabs = useTabsStore((s) => s.tabs);
  return (
    <ul aria-label="tree">
      {Object.values(tabs).map((t) => (
        <li key={t.componentUuid}>{t.title}</li>
      ))}
    </ul>
  );
}

function renderPage() {
  return render(
    <SnackbarHost>
      <ExportImportPage />
      <Titles />
    </SnackbarHost>,
  );
}

let clipboard: string | null;

beforeEach(async () => {
  await resetTimDb();
  globalThis.indexedDB = new IDBFactory();
  useTabsStore.reset();
  clipboard = null;
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      writeText: (t: string) => {
        clipboard = t;
        return Promise.resolve();
      },
    },
  });
});
afterEach(async () => {
  vi.restoreAllMocks();
  await useTabsStore.getState().flush();
  await resetTimDb();
});

const box = () => screen.getByRole('textbox', { name: 'Settings (JSON)' });
const importBtn = () => screen.getByRole('button', { name: 'Import' });

describe('ExportImportPage', () => {
  it('round trips: export, wipe, import; tabs appear without refresh; rows are not exported', async () => {
    const store = useTabsStore.getState();
    await store.load();
    const a = store.createTab({
      componentName: 'KustoQueryResult',
      parentUuid: null,
      title: 'Parent',
      params: { query: 'T | take 1', cluster: 'c', database: 'd' },
    });
    store.createTab({
      componentName: 'KustoQueryResult',
      parentUuid: a,
      title: 'Child',
      params: { query: 'U', cluster: 'c', database: 'd' },
    });
    await rowResultsDao.put(a, [{ x: 1 }]);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect((box() as HTMLTextAreaElement).value).toContain('Parent'));
    const json = (box() as HTMLTextAreaElement).value;
    expect(clipboard).toBe(json);
    expect(json).not.toContain('"x"');

    await store.removeTab(a);
    await waitFor(() => expect(screen.queryByText('Parent')).not.toBeInTheDocument());
    expect(await displayComponentsDao.getAll()).toHaveLength(0);

    await userEvent.click(importBtn());
    expect(await screen.findByText('Parent')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
    expect(await displayComponentsDao.getAll()).toHaveLength(2);
    expect(useTabsStore.getState().tabs[a]?.parentUuid).toBeNull();
  });

  it('exports template tabs without name, status and author fields, and the export re-imports', async () => {
    const store = useTabsStore.getState();
    await store.load();
    store.createTab({
      componentName: 'TemplateQueryResult',
      parentUuid: null,
      title: 'Tpl',
      params: {
        inParams: {},
        queryTemplate: {
          uuid: 'tpl-1',
          query: 'T | take 1',
          name: 'q',
          isDeleted: false,
          isManaged: true,
          createdBy: 'a@b.c',
          updatedBy: 'd@e.f',
          updated: '2026-01-01Z',
        },
      },
    } as never);
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect((box() as HTMLTextAreaElement).value).toContain('Tpl'));
    const json = (box() as HTMLTextAreaElement).value;
    expect(json).not.toMatch(/a@b\.c|d@e\.f/);
    const exported = JSON.parse(json) as { params: { queryTemplate: Record<string, unknown> } }[];
    const qt = exported[0]?.params.queryTemplate ?? {};
    for (const key of ['name', 'isDeleted', 'isManaged', 'createdBy', 'updatedBy', 'updated']) {
      expect(qt).not.toHaveProperty(key);
    }
    expect(qt).toMatchObject({ uuid: 'tpl-1', query: 'T | take 1' });
    await userEvent.clear(box());
    expect(importBtn()).toBeDisabled();
    await userEvent.click(box());
    await userEvent.paste(json);
    expect(importBtn()).toBeEnabled();
  });

  it('disables Import for empty, invalid JSON and schema mismatch', async () => {
    renderPage();
    expect(importBtn()).toBeDisabled();
    await userEvent.click(box());
    await userEvent.paste('{nope');
    expect(importBtn()).toBeDisabled();
    expect(screen.getByText('Not valid JSON.')).toBeInTheDocument();
    await userEvent.clear(box());
    await userEvent.paste('[{"componentUuid":"x"}]');
    expect(importBtn()).toBeDisabled();
    expect(screen.getByText(/Invalid settings/)).toBeInTheDocument();
  });

  it('parseImport resets isExecuting on imported tabs', () => {
    const r = parseImport(
      JSON.stringify([
        {
          componentUuid: 'u',
          componentName: 'TemplateQueryResult',
          title: 't',
          parentUuid: null,
          rowDataTrigger: null,
          displayComponentIndex: 3,
          state: { isVisited: true, error: null, rowCount: 2, isExecuting: true },
          params: { inParams: {}, queryTemplate: { name: 'q' } },
        },
      ]),
    );
    expect(r.ok && r.tabs[0]?.state.isExecuting).toBe(false);
  });

  it('parseImport accepts a template tab whose queryTemplate has no name', () => {
    const r = parseImport(
      JSON.stringify([
        {
          componentUuid: 'u',
          componentName: 'TemplateQueryResult',
          title: 't',
          parentUuid: null,
          rowDataTrigger: null,
          displayComponentIndex: 0,
          state: { isVisited: false, error: null, rowCount: null, isExecuting: false },
          params: { inParams: {}, queryTemplate: { uuid: 'tpl-1', query: 'T | take 1' } },
        },
      ]),
    );
    expect(r.ok).toBe(true);
  });
});
