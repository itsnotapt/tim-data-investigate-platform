import { describe, expect, it, vi } from 'vitest';
import type { Instance } from '../../lib/api';
import { createInstanceStore, refreshInstanceOnFocus } from './instanceStore';

const instance = (version: string, names: string[] = []): Instance => ({
  version,
  actions: names.map((name) => ({
    key: name.toLowerCase(),
    kind: 'query',
    name,
    menuPath: [],
    connections: [],
    params: [],
    pivot: null,
  })),
  connections: [],
  labels: [],
  limits: {
    maxResultRows: 1,
    maxResultBytes: 1,
    maxPivotRows: 100,
    rowsPageSize: 10,
    runTimeoutSeconds: 600,
    maxAnnotationIds: 10_000,
    annotationPollSeconds: 30,
  },
});

function make(...responses: Instance[]) {
  const fetchInstance = vi.fn<() => Promise<Instance>>();
  for (const r of responses) fetchInstance.mockResolvedValueOnce(r);
  return { store: createInstanceStore({ fetchInstance }), fetchInstance };
}

describe('instance store', () => {
  it('loads the instance once', async () => {
    const { store, fetchInstance } = make(instance('v1', ['Sign-ins']));
    await store.getState().load();
    await store.getState().load();
    expect(fetchInstance).toHaveBeenCalledTimes(1);
    expect(store.getState().instance?.actions.map((a) => a.name)).toEqual(['Sign-ins']);
  });

  it('rethrows a failed load, and a later load retries', async () => {
    const { store, fetchInstance } = make();
    fetchInstance.mockRejectedValueOnce(new Error('boom'));
    await expect(store.getState().load()).rejects.toThrow('boom');
    fetchInstance.mockResolvedValueOnce(instance('v1'));
    await store.getState().load();
    expect(store.getState().instance?.version).toBe('v1');
  });

  it('on focus, takes the refetched instance only when its version changed', async () => {
    const { store, fetchInstance } = make(
      instance('v1', ['A']),
      instance('v1', ['A']),
      instance('v2', ['A', 'B']),
    );
    await store.getState().load();
    const loaded = store.getState().instance;
    const target = new EventTarget();
    const stop = refreshInstanceOnFocus(store, target);

    target.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(fetchInstance).toHaveBeenCalledTimes(2));
    expect(store.getState().instance).toBe(loaded);

    target.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(store.getState().instance?.version).toBe('v2'));
    expect(store.getState().instance?.actions.map((a) => a.name)).toEqual(['A', 'B']);

    stop();
    target.dispatchEvent(new Event('focus'));
    expect(fetchInstance).toHaveBeenCalledTimes(3);
  });

  it('keeps the instance it has when a focus refetch fails', async () => {
    const { store, fetchInstance } = make(instance('v1'));
    await store.getState().load();
    fetchInstance.mockRejectedValueOnce(new Error('offline'));
    const target = new EventTarget();
    refreshInstanceOnFocus(store, target);
    target.dispatchEvent(new Event('focus'));
    await vi.waitFor(() => expect(fetchInstance).toHaveBeenCalledTimes(2));
    expect(store.getState().instance?.version).toBe('v1');
  });
});
