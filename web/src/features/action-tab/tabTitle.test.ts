import { describe, expect, it } from 'vitest';
import { DEFAULT_TAB_STATE, type ActionParams, type Tab, type TabState } from '../tabs';
import { tabTitle } from './tabTitle';

const tab = (
  state: Partial<TabState> = {},
  params: Partial<ActionParams> = {},
  title = 'Host timeline',
): Tab => ({
  componentName: 'ActionResult',
  componentUuid: 't1',
  parentUuid: null,
  title,
  rowDataTrigger: null,
  displayComponentIndex: 0,
  state: { ...DEFAULT_TAB_STATE, ...state },
  params: { action: 'host-timeline', params: {}, ...params },
});

const presetTab = (runParams: Record<string, unknown> | null, shown = ['host']) =>
  tab(
    { runTitle: 'Host timeline', runParams },
    {
      presetId: 'p1',
      titleInputs: shown.map((name) => ({ source: 'param', name })),
    },
    'My hosts',
  );

describe('tabTitle', () => {
  it('is the stored title until the tab has run', () => {
    expect(tabTitle(tab())).toBe('Host timeline');
  });

  it("is the latest run's title once the tab has run", () => {
    expect(tabTitle(tab({ runTitle: 'Host timeline BGIST-L' }))).toBe('Host timeline BGIST-L');
  });

  it("is a preset tab's name then its latest run's values of the inputs it shows", () => {
    const runParams = {
      host: 'BGIST-L',
      parameters: [{ name: 'Upn', type: 'string', value: 'alice@contoso.com' }],
    };
    const shown = tab(
      { runTitle: 'Run KQL', runParams },
      {
        presetId: 'p1',
        titleInputs: [
          { source: 'queryParameter', name: 'Upn' },
          { source: 'param', name: 'host' },
        ],
      },
      'My hosts',
    );
    expect(tabTitle(shown)).toBe('My hosts alice@contoso.com BGIST-L');
  });

  it('shows up to two values of a list, then how many more', () => {
    expect(tabTitle(presetTab({ host: ['a', 'b', 'c', 'd'] }))).toBe('My hosts a, b +2');
    expect(tabTitle(presetTab({ host: ['a', 'b'] }))).toBe('My hosts a, b');
  });

  it('leaves out a value that is unset or empty', () => {
    const t = presetTab({ host: '', user: null, ids: [], limit: 0 }, [
      'host',
      'user',
      'ids',
      'limit',
    ]);
    expect(tabTitle(t)).toBe('My hosts 0');
  });

  it("is a preset tab's name when it shows no inputs, or hasn't run", () => {
    expect(tabTitle(presetTab({ host: 'BGIST-L' }, []))).toBe('My hosts');
    expect(tabTitle(presetTab(null))).toBe('My hosts');
  });
});
