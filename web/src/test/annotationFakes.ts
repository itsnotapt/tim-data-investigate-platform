import type { Annotations } from '../lib/api';
import type { AnnotationsChannel, AnnotationsMessage } from '../lib/annotations';

type Listener = (e: MessageEvent<AnnotationsMessage>) => void;

/** A `BroadcastChannel` stand-in: what one tab posts reaches every other tab's channel. */
export function createChannelHub() {
  const channels = new Set<FakeChannel>();
  class FakeChannel implements AnnotationsChannel {
    private readonly listeners = new Set<Listener>();
    constructor() {
      channels.add(this);
    }
    postMessage(message: AnnotationsMessage): void {
      // Structured-cloned and asynchronous, like the real thing.
      const data = structuredClone(message);
      for (const channel of channels) {
        if (channel === this) continue;
        queueMicrotask(() => channel.deliver(data));
      }
    }
    addEventListener(_type: 'message', listener: Listener): void {
      this.listeners.add(listener);
    }
    removeEventListener(_type: 'message', listener: Listener): void {
      this.listeners.delete(listener);
    }
    private deliver(data: AnnotationsMessage): void {
      for (const listener of this.listeners) listener(new MessageEvent('message', { data }));
    }
  }
  return { open: (): AnnotationsChannel => new FakeChannel() };
}

type LockCallback = () => Promise<unknown>;

/** A `navigator.locks` stand-in for exclusive locks: one holder per name, the rest queue. */
export function createFakeLocks() {
  const queues = new Map<string, { callback: LockCallback; signal?: AbortSignal }[]>();
  const held = new Set<string>();
  const next = (name: string) => {
    const queue = queues.get(name) ?? [];
    const waiting = queue.shift();
    if (!waiting) return;
    held.add(name);
    void waiting.callback().finally(() => {
      held.delete(name);
      next(name);
    });
  };
  return {
    request(name: string, options: { signal?: AbortSignal }, callback: LockCallback) {
      return new Promise<void>((resolve, reject) => {
        const entry = {
          signal: options.signal,
          callback: () => callback().then(() => resolve(), reject),
        };
        options.signal?.addEventListener('abort', () => {
          const queue = queues.get(name) ?? [];
          const at = queue.indexOf(entry);
          if (at >= 0) {
            queue.splice(at, 1);
            reject(new DOMException('Aborted', 'AbortError'));
          }
        });
        queues.set(name, [...(queues.get(name) ?? []), entry]);
        if (!held.has(name)) next(name);
      });
    },
  };
}

export function annotated(
  id: string,
  version: number,
  key: string | null = 'malicious',
  by = 'alice@example.com',
): Annotations {
  return {
    id,
    label: key === null ? null : { key, by, at: '2026-10-21T10:00:00Z' },
    tags: [],
    comments: [],
    version,
  };
}
