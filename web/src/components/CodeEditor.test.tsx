import { render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  editor: {
    dispose: vi.fn(),
    getModel: vi.fn(),
    onDidDispose: vi.fn(),
  },
  model: { dispose: vi.fn(), uri: { path: 'm' } },
  editorProps: [] as Record<string, unknown>[],
  loadMonaco: vi.fn(),
  loadMonacoKusto: vi.fn(),
  getKustoWorkerFor: vi.fn(),
}));

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react');
  return {
    Editor: (props: Record<string, unknown>) => {
      h.editorProps.push(props);
      React.useEffect(() => {
        (props.onMount as (e: unknown, m: unknown) => void)(h.editor, { fake: true });
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
      return <div data-testid="monaco" />;
    },
  };
});
vi.mock('../lib/monaco', () => ({
  loadMonaco: h.loadMonaco,
  loadMonacoKusto: h.loadMonacoKusto,
  getKustoWorkerFor: h.getKustoWorkerFor,
}));

import { AppThemeProvider } from '../app/AppThemeProvider';
import { setPrefersColorScheme } from '../test/matchMedia';
import { CodeEditor } from './CodeEditor';
import { useCodeEditor } from './useCodeEditor';

beforeEach(() => {
  vi.clearAllMocks();
  h.editorProps.length = 0;
  h.editor.getModel.mockReturnValue(h.model);
  h.loadMonaco.mockResolvedValue({});
  h.loadMonacoKusto.mockResolvedValue({});
});

describe('CodeEditor', () => {
  it('loads plain monaco for yaml and wires props', async () => {
    const onChange = vi.fn();
    const onMount = vi.fn();
    render(
      <CodeEditor
        value="a: 1"
        language="yaml"
        path="t.yaml"
        readOnly
        onChange={onChange}
        onMount={onMount}
      />,
    );
    await screen.findByTestId('monaco');
    expect(h.loadMonaco).toHaveBeenCalled();
    expect(h.loadMonacoKusto).not.toHaveBeenCalled();
    const props = h.editorProps[0]!;
    expect(props).toMatchObject({ value: 'a: 1', language: 'yaml', path: 't.yaml' });
    const opts = props.options as Record<string, unknown>;
    expect(opts).toMatchObject({ readOnly: true, tabSize: 2, automaticLayout: true });
    expect(opts.suggest).toBeUndefined(); // suggestions stay enabled
    (props.onChange as (v: string | undefined) => void)(undefined);
    expect(onChange).toHaveBeenCalledWith('');
    expect(onMount).toHaveBeenCalledWith(h.editor, { fake: true });
  });

  it('loads the Kusto service for language kusto', async () => {
    render(<CodeEditor value="T" language="kusto" />);
    await screen.findByTestId('monaco');
    expect(h.loadMonacoKusto).toHaveBeenCalled();
  });

  it('uses tim-dark when the colour scheme is dark', async () => {
    localStorage.setItem('tim-theme-mode', 'dark');
    render(<CodeEditor value="" language="yaml" />, { wrapper: AppThemeProvider });
    await screen.findByTestId('monaco');
    expect(h.editorProps.at(-1)).toMatchObject({ theme: 'tim-dark' });
  });

  it('follows a dark OS when the stored mode is junk', async () => {
    localStorage.setItem('tim-theme-mode', 'sepia');
    setPrefersColorScheme('dark');
    render(<CodeEditor value="" language="yaml" />, { wrapper: AppThemeProvider });
    await screen.findByTestId('monaco');
    expect(h.editorProps.at(-1)).toMatchObject({ theme: 'tim-dark' });
  });

  it('uses tim-light when the colour scheme is light', async () => {
    localStorage.setItem('tim-theme-mode', 'light');
    setPrefersColorScheme('dark');
    render(<CodeEditor value="" language="kusto" />, { wrapper: AppThemeProvider });
    await screen.findByTestId('monaco');
    expect(h.editorProps.at(-1)).toMatchObject({ theme: 'tim-light' });
  });

  it('disposes model and editor on unmount', async () => {
    const { unmount } = render(<CodeEditor value="" />);
    await screen.findByTestId('monaco');
    unmount();
    expect(h.model.dispose).toHaveBeenCalled();
    expect(h.editor.dispose).toHaveBeenCalled();
  });

  it('shows an error when monaco fails to load', async () => {
    h.loadMonaco.mockRejectedValue(new Error('boom'));
    render(<CodeEditor value="" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});

describe('useCodeEditor', () => {
  it('exposes the editor and kusto worker after mount, null before', async () => {
    const worker = { setSchemaFromShowSchema: vi.fn() };
    h.getKustoWorkerFor.mockResolvedValue(worker);
    const { result } = renderHook(() => useCodeEditor());
    expect(result.current.getEditor()).toBeNull();
    expect(await result.current.getKustoWorker()).toBeNull();
    result.current.onMount(h.editor as never);
    expect(result.current.getEditor()).toBe(h.editor);
    await waitFor(async () => expect(await result.current.getKustoWorker()).toBe(worker));
    const dispose = h.editor.onDidDispose.mock.calls[0]![0] as () => void;
    dispose();
    expect(result.current.getEditor()).toBeNull();
  });
});
