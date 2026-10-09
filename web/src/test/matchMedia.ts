type Scheme = 'light' | 'dark';
type Listener = (event: MediaQueryListEvent) => void;

/** Each `change` listener with the query it was registered for. */
const listeners = new Map<Listener, string>();
let osScheme: Scheme = 'light';

function matches(query: string): boolean {
  const asked = /prefers-color-scheme:\s*(dark|light)/.exec(query)?.[1];
  return asked === osScheme;
}

/**
 * jsdom has no `matchMedia`. This stub answers `prefers-color-scheme` queries from a switchable OS
 * scheme (light by default) and notifies `change` listeners when it switches; any other query
 * doesn't match. Installed only in the jsdom environment.
 */
function matchMedia(query: string): MediaQueryList {
  const list = {
    media: query,
    get matches() {
      return matches(query);
    },
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => listeners.set(listener, query),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    addListener: (listener: Listener) => listeners.set(listener, query),
    removeListener: (listener: Listener) => listeners.delete(listener),
    dispatchEvent: () => false,
  };
  return list as unknown as MediaQueryList;
}
if (typeof window !== 'undefined') window.matchMedia = matchMedia;

/** Switches the OS colour scheme the `matchMedia` stub reports, notifying `change` listeners. */
export function setPrefersColorScheme(scheme: Scheme): void {
  osScheme = scheme;
  for (const [listener, media] of listeners) {
    listener({ matches: matches(media), media } as MediaQueryListEvent);
  }
}

/** Back to a light OS without notifying; `test-setup.ts` calls it after each test. */
export function resetPrefersColorScheme(): void {
  osScheme = 'light';
  listeners.clear();
}
