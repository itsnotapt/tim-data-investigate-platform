import 'fake-indexeddb/auto';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SnackbarHost } from '../../components/SnackbarHost';
import { resetConfigCache } from '../../lib/config/runtimeConfig';
import { useTabsStore } from '../tabs/tabStore';
import { TemplateQueryTab, VALIDATION_MESSAGE } from './TemplateQueryTab';

// Monaco cannot run in jsdom.
vi.mock('../../components/CodeEditor', () => ({
  CodeEditor: ({ value, ariaLabel }: { value: string; ariaLabel?: string }) => (
    <textarea aria-label={ariaLabel} value={value} readOnly />
  ),
}));

const template = {
  uuid: 't1',
  menu: 'test menu',
  summary: 'Logons for {{user}}',
  path: 'test path',
  cluster: 'https://c.kusto.windows.net',
  query: 'T | where User == {{str user}} | where Flag == {{flag}} | where K in ({{array kinds}})',
  params: {
    user: { default: 'def-user' },
    name: { default: 'def-2', type: 'string', hint: 'A name' },
    flag: { default: true, type: 'boolean' },
    kinds: { default: [], type: 'array', multiple: true, values: ['a', 'b', 'c'] },
    level: { default: 'x', type: 'array', values: ['x', 'y'], optional: true },
    note: { default: '', optional: true },
  },
  fields: {
    ips: { type: 'multiple', from: 'Ip' },
    col: { type: 'match', regex: '^ip' },
  },
};

const baseParams = () => ({
  user: 'param-1',
  name: 'param-2',
  flag: false,
  kinds: ['a'],
  level: 'x',
  note: '',
  ips: ['1.1.1.1'],
  col: [
    { column: 'ipA', value: '10.0.0.1' },
    { column: 'ipB', value: '10.0.0.2' },
  ],
});

function setup(
  inParams: Record<string, unknown> = baseParams(),
  editQuery = true,
  handlers: Record<string, ReturnType<typeof vi.fn>> = {},
) {
  const uuid = useTabsStore.getState().createTab({
    componentName: 'TemplateQueryResult',
    parentUuid: null,
    title: 'Stored title',
    params: { inParams, queryTemplate: template },
    state: { editQuery },
  });
  render(
    <MemoryRouter>
      <SnackbarHost>
        <TemplateQueryTab uuid={uuid} {...handlers} />
      </SnackbarHost>
    </MemoryRouter>,
  );
  return { uuid, user: userEvent.setup() };
}

const tab = (uuid: string) => {
  const t = useTabsStore.getState().tabs[uuid];
  if (t?.componentName !== 'TemplateQueryResult') throw new Error('missing');
  return t;
};

beforeEach(() => {
  useTabsStore.reset();
  window.appConfig = {
    auth: { clientId: 'id', authority: 'https://login.example.com/t' },
    redirectUri: 'https://tim.example.com/blank.html',
    tagCluster: 'https://tags.kusto.windows.net',
  };
  resetConfigCache();
});

describe('TemplateQueryTab param widgets', () => {
  it('renders a param with no type as a text field', () => {
    setup();
    expect(screen.getByRole('textbox', { name: /^user/ })).toBeInTheDocument();
  });

  it('renders a param of type string as a text field with its hint', () => {
    setup();
    expect(screen.getByRole('textbox', { name: /^name/ })).toBeInTheDocument();
    expect(screen.getByText('A name')).toBeInTheDocument();
  });

  it('renders a boolean param as a switch', () => {
    setup();
    expect(screen.getByRole('switch', { name: 'flag' })).toBeInTheDocument();
  });

  it('renders an array param as a select', () => {
    setup();
    expect(screen.getByRole('combobox', { name: /^kinds/ })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /^level/ })).toBeInTheDocument();
  });

  it('shows the param value in the text field', () => {
    setup({ ...baseParams(), user: 'test-1' });
    expect(screen.getByRole('textbox', { name: /^user/ })).toHaveValue('test-1');
  });

  it('shows the param value in the switch', () => {
    setup({ ...baseParams(), flag: true });
    expect(screen.getByRole('switch', { name: 'flag' })).toBeChecked();
  });

  it('shows the param value in the select', () => {
    setup({ ...baseParams(), kinds: ['b', 'c'] });
    expect(screen.getByRole('combobox', { name: /^kinds/ })).toHaveTextContent('b, c');
  });

  it('updates the param value on text change (trimmed)', async () => {
    const { user, uuid } = setup();
    const input = screen.getByRole('textbox', { name: /^user/ });
    await user.clear(input);
    await user.type(input, ' test-1 ');
    expect(input).toHaveValue('test-1');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(tab(uuid).params.inParams.user).toBe('test-1');
  });

  it('updates the param value on switch change', async () => {
    const { user, uuid } = setup();
    const sw = screen.getByRole('switch', { name: 'flag' });
    await user.click(sw);
    expect(sw).toBeChecked();
    await user.click(sw);
    expect(sw).not.toBeChecked();
    await user.click(sw);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(tab(uuid).params.inParams.flag).toBe(true);
  });

  it('updates the param value on select change (multiple appends)', async () => {
    const { user, uuid } = setup();
    await user.click(screen.getByRole('combobox', { name: /^kinds/ }));
    await user.click(await screen.findByRole('option', { name: 'b' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(tab(uuid).params.inParams.kinds).toEqual(['a', 'b']);
  });

  it('keeps a stored value that is not offered by the select', () => {
    setup({ ...baseParams(), level: 'gone' });
    expect(screen.getByRole('combobox', { name: /^level/ })).toHaveTextContent('gone');
  });
});

describe('TemplateQueryTab form', () => {
  it('opens in edit mode when state.editQuery is set and disables run/clone/convert', () => {
    setup();
    expect(screen.getByLabelText('Summary')).toHaveValue('Stored title');
    for (const n of ['Run Query', 'Clone', 'Convert']) {
      expect(screen.getByRole('button', { name: n })).toBeDisabled();
    }
    expect(screen.getByRole('button', { name: 'Save & Run' })).toBeInTheDocument();
  });

  it('is read-only (no form) when editQuery is false, and Edit persists edit mode in the tab', async () => {
    const { user, uuid } = setup(baseParams(), false);
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share Link' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(tab(uuid).state.editQuery).toBe(true);
    expect(screen.getByLabelText('Summary')).toHaveValue('Stored title');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(tab(uuid).state.editQuery).toBe(false);
  });

  it('Cancel discards the draft', async () => {
    const { user, uuid } = setup();
    await user.type(screen.getByRole('textbox', { name: /^user/ }), 'zzz');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(tab(uuid).params.inParams.user).toBe('param-1');
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    expect(screen.getByRole('textbox', { name: /^user/ })).toHaveValue('param-1');
  });

  it('regenerates the summary from the params', async () => {
    const { user } = setup();
    const user1 = screen.getByRole('textbox', { name: /^user/ });
    await user.clear(user1);
    await user.type(user1, 'bob');
    await user.click(screen.getByRole('button', { name: 'Regenerate summary' }));
    expect(screen.getByLabelText('Summary')).toHaveValue('Logons for bob');
  });

  it('shows required asterisks only on required fields and errors after a failed save', async () => {
    const { user, uuid } = setup({ ...baseParams(), user: '', kinds: [] });
    expect(
      screen.getByRole('textbox', { name: /^user/ }).closest('.MuiFormControl-root'),
    ).toHaveTextContent('*');
    expect(
      screen.getByRole('textbox', { name: /^note/ }).closest('.MuiFormControl-root'),
    ).not.toHaveTextContent('*');
    expect(screen.queryByText('Required.')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getAllByText('Required.')).toHaveLength(2);
    expect(await screen.findByText(VALIDATION_MESSAGE)).toBeInTheDocument();
    expect(tab(uuid).params.inParams.user).toBe('');
    expect(tab(uuid).state.editQuery).toBe(true);
  });

  it('Save stores title and params and leaves edit mode without running', async () => {
    const onRun = vi.fn();
    const { user, uuid } = setup(baseParams(), true, { onRun });
    await user.clear(screen.getByLabelText('Summary'));
    await user.type(screen.getByLabelText('Summary'), 'Mine');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(tab(uuid).title).toBe('Mine');
    expect(tab(uuid).state.editQuery).toBe(false);
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Summary')).not.toBeInTheDocument();
  });

  it('Save & Run saves then calls onRun, but not when invalid', async () => {
    const onRun = vi.fn();
    const { user, uuid } = setup({ ...baseParams(), user: '' }, true, { onRun });
    await user.click(screen.getByRole('button', { name: 'Save & Run' }));
    expect(onRun).not.toHaveBeenCalled();
    await user.type(screen.getByRole('textbox', { name: /^user/ }), 'bob');
    await user.click(screen.getByRole('button', { name: 'Save & Run' }));
    expect(onRun).toHaveBeenCalledWith(uuid);
    expect(tab(uuid).params.inParams.user).toBe('bob');
  });

  it('previews the rendered KQL, toggled by show/hide', async () => {
    const { user } = setup();
    expect(screen.queryByLabelText('Query preview')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'show' }));
    const preview = screen.getByLabelText('Query preview');
    expect(preview).toHaveValue(
      "T | where User == @'param-1' | where Flag == false | where K in (@'a')",
    );
    await user.click(screen.getByRole('button', { name: 'hide' }));
    expect(screen.queryByLabelText('Query preview')).not.toBeInTheDocument();
  });

  it('preview follows unsaved edits', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: 'show' }));
    await user.click(screen.getByRole('switch', { name: 'flag' }));
    const preview = screen.getByLabelText<HTMLTextAreaElement>('Query preview');
    expect(preview.value).toContain('Flag == true');
  });

  it('Select All selects every value, and again clears them', async () => {
    const { user } = setup();
    const select = screen.getByRole('combobox', { name: /^kinds/ });
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'Select All' }));
    await waitFor(() => expect(select).toHaveTextContent('a, b, c'));
    await user.click(screen.getByRole('option', { name: 'Select All' }));
    await waitFor(() => expect(select).not.toHaveTextContent('a, b'));
  });

  it('summarises more than five selections', () => {
    setup({ ...baseParams(), kinds: ['1', '2', '3', '4', '5', '6'] });
    expect(screen.getByRole('combobox', { name: /^kinds/ })).toHaveTextContent('1, (+5 others)');
  });

  it('multiple field shows chips, adds on comma and on Enter, removes a chip', async () => {
    const { user, uuid } = setup();
    const input = screen.getByRole('combobox', { name: /^ips/ });
    expect(screen.getByText('1.1.1.1')).toBeInTheDocument();
    await user.type(input, '2.2.2.2,3.3.3.3;4.4.4.4{Enter}');
    expect(screen.getByText('2.2.2.2')).toBeInTheDocument();
    expect(screen.getByText('3.3.3.3')).toBeInTheDocument();
    expect(screen.getByText('4.4.4.4')).toBeInTheDocument();
    const chip = screen.getByText('1.1.1.1').closest('.MuiChip-root') as HTMLElement;
    await user.click(within(chip).getByTestId('CancelIcon'));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(tab(uuid).params.inParams.ips).toEqual(['2.2.2.2', '3.3.3.3', '4.4.4.4']);
  });

  it('match field selects one of the columns found when the tab was created', async () => {
    const { user, uuid } = setup();
    const select = screen.getByRole('combobox', { name: /^col/ });
    expect(select).toHaveTextContent('ipA: 10.0.0.1');
    await user.click(select);
    await user.click(await screen.findByRole('option', { name: 'ipB: 10.0.0.2' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(tab(uuid).params.inParams.col).toEqual([{ column: 'ipB', value: '10.0.0.2' }]);
  });

  it('calls the run, clone and share hooks; Convert asks for confirmation first', async () => {
    const h = { onRun: vi.fn(), onClone: vi.fn(), onConvert: vi.fn(), onShare: vi.fn() };
    const { user, uuid } = setup(baseParams(), false, h);
    await user.click(screen.getByRole('button', { name: 'Run Query' }));
    await user.click(screen.getByRole('button', { name: 'Clone' }));
    await user.click(screen.getByRole('button', { name: 'Share Link' }));
    expect(h.onRun).toHaveBeenCalledWith(uuid);
    expect(h.onClone).toHaveBeenCalledWith(uuid);
    expect(h.onShare).toHaveBeenCalledWith(uuid);

    await user.click(screen.getByRole('button', { name: 'Convert' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Convert to custom query?');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(h.onConvert).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Convert' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Convert' }),
    );
    expect(h.onConvert).toHaveBeenCalledWith(uuid);
  });

  it('shows the stored run error', () => {
    const uuid = useTabsStore.getState().createTab({
      componentName: 'TemplateQueryResult',
      parentUuid: null,
      title: 'x',
      params: { inParams: baseParams(), queryTemplate: template },
      state: { editQuery: false },
    });
    useTabsStore.getState().updateState(uuid, { error: new Error('boom') });
    render(
      <MemoryRouter>
        <SnackbarHost>
          <TemplateQueryTab uuid={uuid} />
        </SnackbarHost>
      </MemoryRouter>,
    );
    expect(screen.getByText('boom')).toBeInTheDocument();
  });
});
