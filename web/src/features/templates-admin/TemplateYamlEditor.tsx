import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { CodeEditor } from '../../components';
import type { EditorLanguage } from '../../lib/monaco';

export interface TemplateYamlEditorProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  language?: EditorLanguage;
  readOnly?: boolean;
  error?: string | null;
  /** Unique Monaco model path. */
  path: string;
}

/** Labelled 200 px dotted-border editor with an error alert under it (legacy CreateQueryDialog). */
export function TemplateYamlEditor({
  label,
  value,
  onChange,
  language = 'yaml',
  readOnly = false,
  error,
  path,
}: TemplateYamlEditorProps) {
  return (
    <Box sx={{ mb: 2 }}>
      <Typography variant="body2" sx={{ mb: 0.5 }}>
        {label}
      </Typography>
      <Box sx={{ border: '1px dotted darkgrey', height: 200 }}>
        <CodeEditor
          value={value}
          onChange={onChange}
          language={language}
          readOnly={readOnly}
          height={200}
          path={path}
          ariaLabel={label}
          options={{ lineNumbers: 'off' }}
        />
      </Box>
      {error ? (
        <Alert severity="error" sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
