import AddIcon from '@mui/icons-material/Add';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import EditIcon from '@mui/icons-material/Edit';
import ErrorOutlineIcon from '@mui/icons-material/Error';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import ShareIcon from '@mui/icons-material/Share';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useMemo, useState } from 'react';
import { CodeEditor } from '../../components/CodeEditor';
import { DraggableDialog } from '../../components/DraggableDialog';
import { useNotify } from '../../components/useNotify';
import { buildQuery, buildSummary, type TemplateParams } from '../../lib/kql-templates';
import { PivotResultsGrid } from '../pivots';
import { NewQueryMenu } from '../new-query';
import type { TabComponentProps } from '../tabs/tabRegistry';
import { useTabsStore } from '../tabs/tabStore';
import { getTabTemplate } from '../tabs/types';
import { useTemplatesStore } from '../templates';
import { ParamField } from './ParamField';
import { getFormFields, validateParams } from './paramRules';
import {
  useCloneTemplateQuery,
  useConvertTemplateQuery,
  useRunTemplateQuery,
  useShareTemplateQuery,
} from './useTemplateTabActions';

export interface TemplateQueryTabProps extends TabComponentProps {
  /** Overrides for the run / clone / convert / share actions (defaults in `useTemplateTabActions`). */
  onRun?: (uuid: string) => void;
  onClone?: (uuid: string) => void;
  onConvert?: (uuid: string) => void;
  onShare?: (uuid: string) => void;
}

interface Draft {
  title: string;
  params: TemplateParams;
}

export const VALIDATION_MESSAGE = 'Unable to save query due to validation errors.';

const Sep = () => <Divider orientation="vertical" flexItem sx={{ mx: 1, my: 0.5 }} />;

function safeBuild(fn: () => string): string {
  try {
    return fn();
  } catch (e) {
    return `// Unable to render the query: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * Template query tab Edit mode is
 * persisted in the tab's `state.editQuery` (new template tabs and incomplete pivots open in it);
 * edits live in a local draft until Save / Save & Run.
 */
export function TemplateQueryTab({
  uuid,
  onRun,
  onClone,
  onConvert,
  onShare,
}: TemplateQueryTabProps) {
  const tab = useTabsStore((s) => s.tabs[uuid]);
  const templates = useTemplatesStore((s) => s.templates);
  const queryOptions = useTemplatesStore((s) => s.queryOptions);
  const notify = useNotify();
  const defaultRun = useRunTemplateQuery();
  const defaultClone = useCloneTemplateQuery();
  const defaultConvert = useConvertTemplateQuery();
  const defaultShare = useShareTemplateQuery();
  const run = onRun ?? defaultRun;
  const clone = onClone ?? defaultClone;
  const convert = onConvert ?? defaultConvert;
  const share = onShare ?? defaultShare;

  const [draft, setDraft] = useState<Draft | null>(null);
  /** Params when edit mode started: suggestions for `match` / `multiple`. */
  const [initial, setInitial] = useState<TemplateParams | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [viewQuery, setViewQuery] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);

  const isTemplate = tab?.componentName === 'TemplateQueryResult';
  const template = useMemo(() => (isTemplate ? getTabTemplate(tab) : null), [isTemplate, tab]);
  const fields = useMemo(() => (template ? getFormFields(template) : []), [template]);

  if (tab?.componentName !== 'TemplateQueryResult' || !template) return null;
  const { title, state } = tab;
  const inParams = tab.params.inParams;
  const editing = state.editQuery === true;

  const form: Draft = draft ?? { title, params: { ...inParams } };
  const suggestions = initial ?? inParams;
  const errors = showErrors ? validateParams(fields, form.params) : {};
  const store = useTabsStore.getState;

  const setParam = (name: string, value: unknown) =>
    setDraft({ ...form, params: { ...form.params, [name]: value } });
  const leaveEdit = () => {
    setDraft(null);
    setInitial(null);
    setShowErrors(false);
    store().updateState(uuid, { editQuery: false });
  };
  const startEdit = () => {
    setDraft({ title, params: { ...inParams } });
    setInitial({ ...inParams });
    setShowErrors(false);
    store().updateState(uuid, { editQuery: true });
  };
  /** Returns false when validation fails (nothing is saved). */
  const save = (): boolean => {
    if (Object.keys(validateParams(fields, form.params)).length > 0) {
      setShowErrors(true);
      notify({ message: VALIDATION_MESSAGE, icon: <ErrorOutlineIcon color="error" /> });
      return false;
    }
    store().updateTitle(uuid, form.title);
    store().updateParams(uuid, { inParams: { ...form.params } });
    leaveEdit();
    return true;
  };
  const saveAndRun = () => {
    if (save()) run(uuid);
  };

  const preview = editing ? safeBuild(() => buildQuery(template, form.params)) : '';

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', px: 1 }}>
        <NewQueryMenu templates={templates} queryOptions={queryOptions} size="small">
          <AddIcon fontSize="small" sx={{ mr: 0.5 }} />
          New
        </NewQueryMenu>
        <Sep />
        <Button
          size="small"
          color="inherit"
          startIcon={<PlayArrowIcon />}
          disabled={editing}
          onClick={() => run(uuid)}
        >
          Run Query
        </Button>
        <Button
          size="small"
          color="inherit"
          startIcon={<ContentCopyIcon />}
          disabled={editing}
          onClick={() => clone(uuid)}
        >
          Clone
        </Button>
        <Button
          size="small"
          color="inherit"
          disabled={editing}
          onClick={() => setConvertOpen(true)}
        >
          Convert
        </Button>
        <Sep />
        {!editing && (
          <>
            <Button size="small" color="inherit" startIcon={<EditIcon />} onClick={startEdit}>
              Edit
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<ShareIcon />}
              onClick={() => share(uuid)}
            >
              Share Link
            </Button>
          </>
        )}
        {editing && (
          <>
            <Button size="small" startIcon={<PlayArrowIcon />} onClick={saveAndRun}>
              Save & Run
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<SaveIcon />}
              onClick={() => void save()}
            >
              Save
            </Button>
            <Button size="small" color="inherit" onClick={leaveEdit}>
              Cancel
            </Button>
          </>
        )}
      </Box>

      {editing && (
        <Box component="form" noValidate sx={{ mx: 2 }} onSubmit={(e) => e.preventDefault()}>
          <TextField
            label="Summary"
            value={form.title}
            onChange={(e) => setDraft({ ...form, title: e.target.value })}
            fullWidth
            margin="normal"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <IconButton
                      size="small"
                      aria-label="Regenerate summary"
                      onClick={() =>
                        setDraft({
                          ...form,
                          title: safeBuild(() => buildSummary(template, form.params)),
                        })
                      }
                    >
                      <RefreshIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
              alignItems: 'start',
            }}
          >
            {fields.map(({ name, field }) => (
              <ParamField
                key={name}
                name={name}
                field={field}
                value={form.params[name]}
                initialValue={suggestions[name]}
                error={errors[name]}
                onChange={(v) => setParam(name, v)}
              />
            ))}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', mt: 2 }}>
            <Typography variant="subtitle1">Preview Query</Typography>
            <Link
              component="button"
              type="button"
              variant="body2"
              sx={{ ml: 'auto' }}
              onClick={() => setViewQuery(!viewQuery)}
            >
              {viewQuery ? 'hide' : 'show'}
            </Link>
          </Box>
          <Divider sx={{ mb: 1.5 }} />
          {viewQuery && (
            <Box sx={{ height: 400, border: '1px dotted', borderColor: 'editor.border', mb: 2 }}>
              <CodeEditor
                language="kusto"
                path={`${uuid}.preview.kusto`}
                ariaLabel="Query preview"
                readOnly
                value={preview}
              />
            </Box>
          )}
        </Box>
      )}

      {state.error && (
        <Alert severity="error" variant="outlined" sx={{ mx: 2, mb: 1 }}>
          <Box
            component="pre"
            sx={{ m: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '0.75em' }}
          >
            {state.error.message}
          </Box>
        </Alert>
      )}

      <Box data-slot="results-grid">
        {tab.rowDataTrigger !== null && <PivotResultsGrid uuid={uuid} />}
      </Box>

      <DraggableDialog
        open={convertOpen}
        onClose={() => setConvertOpen(false)}
        title="Convert to custom query?"
        maxWidth="sm"
        fullWidth
        actions={
          <>
            <Button color="inherit" onClick={() => setConvertOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                setConvertOpen(false);
                convert(uuid);
              }}
            >
              Convert
            </Button>
          </>
        }
      >
        This will convert the templated query into a custom query by making all parameters constant.
        This will allow you to modify the KQL directly. Note that this is permanent and cannot be
        undone.
      </DraggableDialog>
    </Box>
  );
}
