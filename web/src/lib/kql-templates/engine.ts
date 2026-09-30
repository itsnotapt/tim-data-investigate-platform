import Handlebars from 'handlebars';
import { getConfig } from '../config/runtimeConfig';
import { kqlVerbatimList, escapeKqlString, escapeKqlVerbatim, stringifyValue } from './escape';
import { buildTagEventsPartial } from './tagEvents';
import type { QueryTemplate, TemplateParams } from './types';

export interface TemplateEngine {
  buildSummary(template: QueryTemplate, params: TemplateParams): string;
  buildCluster(template: QueryTemplate, params: TemplateParams): string;
  buildQuery(template: QueryTemplate, params: TemplateParams): string;
  /** Render arbitrary Handlebars source (mainly for tests and the query preview). */
  render(source: string, params: TemplateParams): string;
}

export interface EngineOptions {
  tagCluster: string;
  tagDatabase: string;
}

/**
 * An isolated Handlebars environment (never the global one, so other code registering helpers
 * cannot change KQL output). Output is not HTML-escaped (`noEscape`, as legacy: this is KQL, not
 * HTML). Escaping happens in literal helpers only (Q-024):
 * - `{{array xs}}`: `@'a','b'` with quotes doubled (legacy output for ordinary values);
 * - `{{str x}}`: one `@'x'` verbatim literal, quotes doubled;
 * - `{{kql x}}`: one regular `'x'` literal, backslash/quotes/newlines escaped;
 * - raw `{{x}}` is substituted unchanged (templates relying on it keep working; authors are
 *   expected to use a helper around user-controlled values).
 */
export function createTemplateEngine(options: EngineOptions): TemplateEngine {
  const hbs = Handlebars.create();
  hbs.registerPartial(
    'getTagEvents',
    buildTagEventsPartial(options.tagCluster, options.tagDatabase),
  );
  hbs.registerHelper('array', (items: unknown) => kqlVerbatimList(items));
  hbs.registerHelper('str', (value: unknown) => `@'${escapeKqlVerbatim(stringifyValue(value))}'`);
  hbs.registerHelper('kql', (value: unknown) => `'${escapeKqlString(stringifyValue(value))}'`);

  const render = (source: string, params: TemplateParams): string =>
    hbs.compile(source, { noEscape: true })(params);

  return {
    render,
    buildSummary: (t, p) => render(t.summary, p),
    buildCluster: (t, p) => render(t.cluster, p),
    buildQuery: (t, p) => render(t.query, p),
  };
}

let defaultEngine: TemplateEngine | undefined;

/** Engine configured from runtime config (tag cluster/database), created on first use. */
export function getTemplateEngine(): TemplateEngine {
  if (!defaultEngine) {
    const { tagCluster, tagDatabase } = getConfig();
    defaultEngine = createTemplateEngine({ tagCluster, tagDatabase });
  }
  return defaultEngine;
}

export function resetTemplateEngine(): void {
  defaultEngine = undefined;
}

export const buildSummary = (t: QueryTemplate, p: TemplateParams): string =>
  getTemplateEngine().buildSummary(t, p);
export const buildCluster = (t: QueryTemplate, p: TemplateParams): string =>
  getTemplateEngine().buildCluster(t, p);
export const buildQuery = (t: QueryTemplate, p: TemplateParams): string =>
  getTemplateEngine().buildQuery(t, p);
