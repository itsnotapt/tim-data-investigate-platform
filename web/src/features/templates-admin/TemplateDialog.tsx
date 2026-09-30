import { useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useNotify } from '../../components';
import { createTemplate, replaceTemplate, type ApiClient, type QueryTemplate } from '../../lib/api';
import {
  buildBody,
  describeSaveError,
  emptyForm,
  formFromTemplate,
  type FormErrors,
  type TemplateFormState,
} from './templateForm';
import { TemplateYamlEditor } from './TemplateYamlEditor';

export interface TemplateDialogProps {
  /** Template to edit; `null` creates a new one. */
  template: QueryTemplate | null;
  onClose: () => void;
  /** Called with the stored template after a successful save (the dialog does not close itself). */
  onSaved: (saved: QueryTemplate) => void | Promise<void>;
  client?: ApiClient;
}

type TextKey = 'name' | 'menu' | 'summary' | 'cluster' | 'database' | 'columnId';

/** Create/Edit template dialog (legacy CreateQueryDialog). Mount it only while open. */
export function TemplateDialog({ template, onClose, onSaved, client }: TemplateDialogProps) {
  const notify = useNotify();
  const editing = template !== null;
  const [form, setForm] = useState<TemplateFormState>(() =>
    template ? formFromTemplate(template) : emptyForm(),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const managed = form.isManaged;

  const set = <K extends keyof TemplateFormState>(key: K, value: TemplateFormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }));
  };

  const text = (key: TextKey, label: string, hint?: string, required = false) => {
    const error = errors[key as keyof FormErrors];
    return (
      <TextField
        label={label}
        value={form[key]}
        onChange={(e) => set(key, e.target.value)}
        required={required}
        disabled={managed}
        error={Boolean(error)}
        helperText={error ?? hint}
        variant="filled"
        fullWidth
      />
    );
  };

  const save = async () => {
    setSaveError(null);
    const built = buildBody(form);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setSaving(true);
    notify('Saving query...');
    try {
      const saved = editing
        ? await replaceTemplate(form.uuid, built.body, { client })
        : await createTemplate(built.body, { client });
      await onSaved(saved);
      notify('Successfully saved query.');
    } catch (e) {
      const message = describeSaveError(e);
      setSaveError(message);
      notify(message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      fullWidth
      maxWidth={false}
      slotProps={{ paper: { sx: { maxWidth: 800 } } }}
      onClose={(_e, reason) => {
        if (reason === 'escapeKeyDown') onClose();
      }}
      aria-labelledby="template-dialog-title"
    >
      <DialogTitle id="template-dialog-title">{editing ? 'Edit' : 'Create'} Query</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ pt: 1 }}>
          {managed ? (
            <Alert severity="warning" variant="outlined">
              This query is being managed by source control.
            </Alert>
          ) : null}
          {text('name', 'Name', undefined, true)}
          <FormControl disabled={managed}>
            <FormLabel id="template-type-label">Select type of query</FormLabel>
            <RadioGroup
              row
              aria-labelledby="template-type-label"
              value={form.queryType}
              onChange={(e) => set('queryType', e.target.value === 'query' ? 'query' : 'view')}
            >
              <FormControlLabel value="view" control={<Radio />} label="View" />
              <FormControlLabel value="query" control={<Radio />} label="Query" />
            </RadioGroup>
          </FormControl>
          {text('menu', 'Menu text', 'e.g. Show all children processes', true)}
          {text(
            'summary',
            'Summary text',
            'Supports {{variable}} e.g. Timeline for {{MachineId}}',
            true,
          )}
          <Autocomplete
            multiple
            freeSolo
            autoSelect
            options={[] as string[]}
            value={form.path}
            disabled={managed}
            onChange={(_e, value) => set('path', value)}
            renderValue={(value, getItemProps) =>
              value.map((option, index) => {
                const { key, ...props } = getItemProps({ index });
                return <Chip key={key} label={option} size="small" {...props} />;
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                label="Path"
                variant="filled"
                helperText="The submenu path for this menu item e.g. Machine, Windows"
              />
            )}
          />
          {text(
            'cluster',
            'Cluster',
            'Domain name for cluster. Supports {{variable}} e.g. {{Cluster}}',
            true,
          )}
          {text('database', 'Database', undefined, true)}
          {text('columnId', 'Column Id', 'Used as a unique identifier for each row e.g. EventId')}
          <TemplateYamlEditor
            label="Params"
            path={`template-${form.uuid}-params.yaml`}
            value={form.params}
            onChange={(v) => set('params', v)}
            readOnly={managed}
            error={errors.params}
          />
          {form.queryType === 'query' ? (
            <TemplateYamlEditor
              label="Fields"
              path={`template-${form.uuid}-fields.yaml`}
              value={form.fields}
              onChange={(v) => set('fields', v)}
              readOnly={managed}
              error={errors.fields}
            />
          ) : null}
          <TemplateYamlEditor
            label="Column customisation"
            path={`template-${form.uuid}-columns.yaml`}
            value={form.columns}
            onChange={(v) => set('columns', v)}
            readOnly={managed}
            error={errors.columns}
          />
          <TemplateYamlEditor
            label="Query"
            language="plaintext"
            path={`template-${form.uuid}-query.txt`}
            value={form.query}
            onChange={(v) => set('query', v)}
            readOnly={managed}
            error={errors.query}
          />
          {saveError ? (
            <Alert severity="error" sx={{ whiteSpace: 'pre-wrap' }}>
              {saveError}
            </Alert>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button onClick={() => void save()} disabled={managed || saving}>
          {editing ? 'Save' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
