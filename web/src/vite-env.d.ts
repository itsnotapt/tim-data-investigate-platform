/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_AUTH_CLIENT_ID?: string;
  readonly VITE_AUTH_AUTHORITY?: string;
  readonly VITE_AUTH_REDIRECT?: string;
  /** `true` selects the dev stub auth client (never allowed in a production build). */
  readonly VITE_AUTH_STUB?: string;
  readonly VITE_API_ENDPOINT?: string;
  readonly VITE_AGGRID_LICENSE_KEY?: string;
  readonly VITE_HELP_WIKI_URI?: string;
  readonly VITE_HELP_ISSUE_URI?: string;
  readonly VITE_TAG_CLUSTER?: string;
  readonly VITE_TAG_DATABASE?: string;
  /** JSON array of `{name, clusters[], databases[]}`. */
  readonly VITE_DEFAULT_CLUSTERS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface Window {
  /** Runtime config injected by `/config.js`. Untrusted until parsed by `lib/config`. */
  appConfig?: Record<string, unknown>;
}
