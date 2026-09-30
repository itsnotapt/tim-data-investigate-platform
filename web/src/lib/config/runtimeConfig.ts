import { z } from 'zod';

const DEFAULT_WIKI_URI = 'https://github.com/itsnotapt/tim-data-investigate-platform/wiki';
const DEFAULT_ISSUE_URI = 'https://github.com/itsnotapt/tim-data-investigate-platform/issues';

const DEFAULT_CLUSTERS = [
  { name: 'Example', clusters: ['https://help.kusto.windows.net'], databases: ['Samples'] },
];

/** `$VAR` / `${VAR}` left behind by an envsubst that had no value. */
const PLACEHOLDER = /^\$(\{[A-Za-z_][A-Za-z0-9_]*\}|[A-Za-z_][A-Za-z0-9_]*)$/;

const httpUrl = z.url({ protocol: /^https?$/, error: 'must be an http(s) URL' });

const clusterGroup = z.object({
  name: z.string().min(1),
  clusters: z.array(z.string().min(1)).min(1),
  databases: z.array(z.string().min(1)),
});

const configSchema = z.object({
  auth: z.object({
    clientId: z.string({ error: 'is required' }).min(1),
    authority: httpUrl,
  }),
  redirectUri: httpUrl,
  /** Same-origin API when empty. Trailing slashes are stripped. */
  apiEndpoint: z
    .string()
    .default('')
    .transform((v) => v.replace(/\/+$/, '')),
  /** Optional in development (trial); production deployments must supply it (ADR-0006). */
  agGridLicenseKey: z.string().optional(),
  wikiUri: httpUrl.default(DEFAULT_WIKI_URI),
  issueUri: httpUrl.default(DEFAULT_ISSUE_URI),
  tagCluster: httpUrl,
  tagDatabase: z.string().min(1).default('Research'),
  defaultClusters: z.array(clusterGroup).default(DEFAULT_CLUSTERS),
});

export type RuntimeConfig = z.infer<typeof configSchema>;

export type EnvSource = Record<string, unknown>;

/** Empty strings and unsubstituted placeholders become `undefined`; recurses into arrays/objects. */
function clean(value: unknown): unknown {
  if (typeof value === 'string') {
    const t = value.trim();
    return t === '' || PLACEHOLDER.test(t) ? undefined : t;
  }
  if (Array.isArray(value)) return value.map(clean).filter((v) => v !== undefined);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([k, v]) => [k, clean(v)] as const)
        .filter(([, v]) => v !== undefined),
    );
  }
  return value ?? undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Drops cluster groups whose only clusters were unsubstituted placeholders. */
function dropEmptyGroups(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const kept = value.filter((g) => {
    const clusters = asRecord(g)['clusters'];
    return !(Array.isArray(clusters) && clusters.length === 0);
  });
  return kept.length > 0 ? kept : undefined;
}

function parseJsonEnv(raw: unknown): { value?: unknown; error?: string } {
  if (typeof raw !== 'string') return { value: raw };
  try {
    return { value: JSON.parse(raw) };
  } catch {
    return { error: 'VITE_DEFAULT_CLUSTERS is not valid JSON' };
  }
}

/**
 * Pure: merges `windowConfig` over `env` (`VITE_*`) per key, then validates.
 * Throws one Error listing every missing or invalid key.
 */
export function loadRuntimeConfig(windowConfig: unknown, env: EnvSource): RuntimeConfig {
  const w = asRecord(clean(windowConfig));
  const wAuth = asRecord(w['auth']);
  const e = asRecord(clean(env));

  const problems: string[] = [];
  const envClusters = parseJsonEnv(e['VITE_DEFAULT_CLUSTERS']);
  if (envClusters.error) problems.push(envClusters.error);

  const merged = {
    auth: {
      clientId: wAuth['clientId'] ?? e['VITE_AUTH_CLIENT_ID'],
      authority: wAuth['authority'] ?? e['VITE_AUTH_AUTHORITY'],
    },
    redirectUri: w['redirectUri'] ?? e['VITE_AUTH_REDIRECT'],
    apiEndpoint: w['apiEndpoint'] ?? e['VITE_API_ENDPOINT'],
    agGridLicenseKey: w['agGridLicenseKey'] ?? e['VITE_AGGRID_LICENSE_KEY'],
    wikiUri: w['wikiUri'] ?? e['VITE_HELP_WIKI_URI'],
    issueUri: w['issueUri'] ?? e['VITE_HELP_ISSUE_URI'],
    tagCluster: w['tagCluster'] ?? e['VITE_TAG_CLUSTER'],
    tagDatabase: w['tagDatabase'] ?? e['VITE_TAG_DATABASE'],
    defaultClusters: dropEmptyGroups(w['defaultClusters'] ?? envClusters.value),
  };

  const result = configSchema.safeParse(merged);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const key = issue.path.join('.') || '(root)';
      const missing = issue.code === 'invalid_type' && issue.input === undefined;
      problems.push(`${key}: ${missing ? 'missing (required)' : issue.message}`);
    }
  }
  if (problems.length > 0 || !result.success) {
    throw new Error(
      `Invalid runtime configuration (window.appConfig / VITE_* env):\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
  return result.data;
}

let cached: RuntimeConfig | undefined;

/** Loads once from `window.appConfig` and `import.meta.env`, then returns the cached value. */
export function getConfig(): RuntimeConfig {
  cached ??= loadRuntimeConfig(window.appConfig, import.meta.env);
  return cached;
}

/** Test helper. */
export function resetConfigCache(): void {
  cached = undefined;
}
