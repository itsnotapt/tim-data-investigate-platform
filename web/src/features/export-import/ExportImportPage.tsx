import ExportIcon from '@mui/icons-material/FileUpload';
import ImportIcon from '@mui/icons-material/FileDownload';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import { useMemo, useState } from 'react';
import { useNotify } from '../../components';
import { exportTabsJson, importTabs, parseImport } from './exportImport';

export default function ExportImportPage() {
  const notify = useNotify();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => (text.trim() === '' ? null : parseImport(text)), [text]);
  const invalid = parsed && !parsed.ok ? parsed.message : null;

  const onExport = async () => {
    try {
      const json = await exportTabsJson();
      setText(json);
      try {
        await navigator.clipboard.writeText(json);
        notify('All settings have been exported and saved to your clipboard.');
      } catch {
        notify('All settings have been exported. Copying to the clipboard failed.');
      }
    } catch (e) {
      notify(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const onImport = async () => {
    if (!parsed?.ok) return;
    setBusy(true);
    try {
      await importTabs(parsed.tabs);
      notify('All settings have been imported.');
    } catch (e) {
      notify(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Stack spacing={2} sx={{ maxWidth: 900 }}>
      <Typography variant="h5" component="h2">
        Export / Import
      </Typography>
      <TextField
        label="Settings (JSON)"
        multiline
        minRows={10}
        maxRows={24}
        value={text}
        onChange={(e) => setText(e.target.value)}
        error={invalid !== null}
        helperText={invalid}
        fullWidth
      />
      <Stack direction="row" spacing={2}>
        <Button variant="outlined" startIcon={<ExportIcon />} onClick={() => void onExport()}>
          Export
        </Button>
        <Button
          variant="outlined"
          startIcon={<ImportIcon />}
          disabled={!parsed?.ok || busy}
          onClick={() => void onImport()}
        >
          Import
        </Button>
      </Stack>
    </Stack>
  );
}
