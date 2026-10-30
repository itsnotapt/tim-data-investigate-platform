/**
 * Replacement for `components/CodeEditor` (Monaco does not run in jsdom): a labelled textarea,
 * with its header line above it.
 */
export async function fakeCodeEditorModule() {
  const React = await import('react');
  return {
    CodeEditor: (p: {
      value: string;
      onChange?: (v: string) => void;
      readOnly?: boolean;
      ariaLabel?: string;
      language?: string;
      headerLine?: string;
    }) =>
      React.createElement(
        React.Fragment,
        null,
        p.headerLine && React.createElement('div', null, p.headerLine),
        React.createElement('textarea', {
          'aria-label': p.ariaLabel,
          'data-language': p.language,
          value: p.value,
          readOnly: p.readOnly,
          onChange: (e: { target: { value: string } }) => p.onChange?.(e.target.value),
        }),
      ),
  };
}
