import type { QueryTemplate, TemplateParams } from '../../lib/kql-templates';
import { getDefaultParams } from '../../lib/kql-templates/params';

export const TEMPLATE_NOT_FOUND = 'This query was not found.';
export const PARAMS_MISSING = 'Parameters are missing.';
export const PARAMS_INVALID = 'Parameters are invalid.';

/** base64url of the UTF-8 bytes of the JSON. */
export function encodeShareParams(params: TemplateParams): string {
  const bytes = new TextEncoder().encode(JSON.stringify(params));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes `p` (base64url of UTF-8 JSON). Throws on garbage. */
export function decodeShareParams(p: string): unknown {
  const bin = atob(p.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** `<origin><path>#/share/<uuid>?p=...&execute=0|1`. */
export function buildShareUrl(
  templateUuid: string,
  params: TemplateParams,
  execute = false,
  base = `${window.location.origin}${window.location.pathname}`,
): string {
  const p = encodeURIComponent(encodeShareParams(params));
  return `${base}#/share/${encodeURIComponent(templateUuid)}?p=${p}&execute=${execute ? 1 : 0}`;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Validates decoded params against the template: must be an object; only params and fields the
 * template declares are kept (merged over its defaults); a bare-string `match` value becomes
 * `[{column: '', value}]`. Returns null when the payload is not an object.
 */
export function sanitizeShareParams(template: QueryTemplate, raw: unknown): TemplateParams | null {
  if (!isObject(raw)) return null;
  const params = getDefaultParams(template);
  const declared = new Set([
    ...Object.keys(template.params ?? {}),
    ...Object.keys(template.fields ?? {}),
  ]);
  for (const name of declared) {
    if (!Object.hasOwn(raw, name)) continue;
    let value = raw[name];
    if (template.fields?.[name]?.type === 'match' && typeof value === 'string') {
      value = value === '' ? [] : [{ column: '', value }];
    }
    params[name] = value;
  }
  return params;
}
