import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetConfigCache } from '../../lib/config/runtimeConfig';
import { useTabsStore } from '../tabs/tabStore';
import { useTemplatesStore } from '../templates';
import ShareQueryPage from './ShareQueryPage';
import { encodeShareParams } from './shareLink';

vi.mock('../tabs/tabStore', async (importOriginal) => {
  const m = await importOriginal<typeof import('../tabs/tabStore')>();
  const store = m.createTabsStore({
    persistence: {
      loadAll: () => Promise.resolve([]),
      save: () => Promise.resolve(),
      remove: () => Promise.resolve(),
    },
    debounceMs: 1,
  });
  return { ...m, useTabsStore: store };
});
const run = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('../template-query/runTemplateQuery', () => ({ runTemplateQuery: run }));

const template = {
  uuid: 't1',
  menu: 'm',
  summary: 'User {{user}}',
  path: 'p',
  cluster: 'c',
  database: 'Db',
  query: 'T',
  params: { user: { default: '' } },
};

function Loc() {
  return <div data-testid="loc">{useLocation().pathname}</div>;
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="share/:uuid" element={<ShareQueryPage />} />
        <Route path="view/:uuid" element={<Loc />} />
      </Routes>
    </MemoryRouter>,
  );
}

const link = (params: Record<string, unknown>, execute = 0, uuid = 't1') =>
  `/share/${uuid}?p=${encodeURIComponent(encodeShareParams(params))}&execute=${execute}`;

beforeEach(() => {
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
  };
  resetConfigCache();
  run.mockClear();
  useTabsStore.reset();
  useTemplatesStore.setState({ templates: [template] as never, loaded: true });
});

describe('ShareQueryPage', () => {
  it('shows the legacy error texts', async () => {
    renderAt(link({}, 0, 'nope'));
    expect(await screen.findByText('This query was not found.')).toBeInTheDocument();
  });

  it('errors when params are missing', async () => {
    renderAt('/share/t1');
    expect(await screen.findByText('Parameters are missing.')).toBeInTheDocument();
  });

  it('errors when params are invalid', async () => {
    renderAt('/share/t1?p=%25%25');
    expect(await screen.findByText('Parameters are invalid.')).toBeInTheDocument();
  });

  it('recreates a root tab in edit mode and navigates, without running (execute=0)', async () => {
    renderAt(link({ user: 'bob 😀', evil: 1 }));
    const loc = await screen.findByTestId('loc');
    const tabs = Object.values(useTabsStore.getState().tabs);
    expect(tabs).toHaveLength(1);
    const tab = tabs[0]!;
    expect(loc).toHaveTextContent(`/view/${tab.componentUuid}`);
    expect(tab.parentUuid).toBeNull();
    expect(tab.title).toBe('User bob 😀');
    expect(tab.componentName === 'TemplateQueryResult' && tab.params.inParams).toEqual({
      user: 'bob 😀',
    });
    expect(tab.state.editQuery).toBe(true);
    expect(run).not.toHaveBeenCalled();
  });

  it('decodes a legacy btoa link', async () => {
    const p = encodeURIComponent(btoa(JSON.stringify({ user: 'old' })));
    renderAt(`/share/t1?p=${p}&execute=0`);
    await screen.findByTestId('loc');
    expect(Object.values(useTabsStore.getState().tabs)[0]?.title).toBe('User old');
  });

  it('execute=1 creates the tab and runs it immediately, without a dialog', async () => {
    renderAt(link({ user: 'bob' }, 1));
    await screen.findByTestId('loc');
    expect(screen.queryByText('Run shared query?')).not.toBeInTheDocument();
    const tab = Object.values(useTabsStore.getState().tabs)[0]!;
    expect(run).toHaveBeenCalledWith(tab.componentUuid);
    expect(tab.state.editQuery).toBe(false);
  });
});
