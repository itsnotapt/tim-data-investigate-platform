import { describe, expect, it, vi } from 'vitest';
import type { QueryTemplate } from '../../lib/api';
import { createTemplatesStore } from './templatesStore';

const tpl = (uuid: string, isDeleted = false) => ({ uuid, isDeleted }) as QueryTemplate;

function make(templates: QueryTemplate[] = [tpl('a'), tpl('b', true)]) {
  const fetchTemplates = vi.fn().mockResolvedValue(templates);
  const saveQueryOption = vi.fn().mockResolvedValue(undefined);
  const store = createTemplatesStore({
    fetchTemplates,
    loadQueryOptions: () => Promise.resolve({ a: { hide: true } }),
    saveQueryOption,
  });
  return { store, fetchTemplates, saveQueryOption };
}

describe('templates store', () => {
  it('loads once, drops deleted templates and loads query options', async () => {
    const { store, fetchTemplates } = make();
    await store.getState().load();
    await store.getState().load();
    expect(fetchTemplates).toHaveBeenCalledTimes(1);
    expect(store.getState().templates.map((t) => t.uuid)).toEqual(['a']);
    expect(store.getState().queryOptions).toEqual({ a: { hide: true } });
    expect(store.getState().loaded).toBe(true);
  });

  it('reload refetches; concurrent calls share one request', async () => {
    const { store, fetchTemplates } = make();
    await Promise.all([store.getState().load(), store.getState().load()]);
    expect(fetchTemplates).toHaveBeenCalledTimes(1);
    await store.getState().reload();
    expect(fetchTemplates).toHaveBeenCalledTimes(2);
  });

  it('records the error, rethrows, and can be retried', async () => {
    const { store, fetchTemplates } = make();
    fetchTemplates.mockRejectedValueOnce(new Error('boom'));
    await expect(store.getState().load()).rejects.toThrow('boom');
    expect(store.getState()).toMatchObject({ loaded: false, loading: false, error: 'boom' });
    await store.getState().load();
    expect(store.getState()).toMatchObject({ loaded: true, error: null });
  });

  it('upsert / remove / setQueryOption', async () => {
    const { store, saveQueryOption } = make();
    await store.getState().load();
    store.getState().upsert(tpl('c'));
    store.getState().upsert(tpl('a', true));
    expect(store.getState().templates.map((t) => t.uuid)).toEqual(['c']);
    store.getState().remove('c');
    expect(store.getState().templates).toEqual([]);
    await store.getState().setQueryOption('a', { x: 1 });
    expect(saveQueryOption).toHaveBeenCalledWith('a', { hide: true, x: 1 });
    expect(store.getState().queryOptions['a']).toEqual({ hide: true, x: 1 });
  });
});
