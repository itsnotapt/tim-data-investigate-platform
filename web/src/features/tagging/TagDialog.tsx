import { useContext, useEffect, useMemo, useState } from 'react';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import type { CallOptions } from '../../lib/api';
import { DraggableDialog } from '../../components/DraggableDialog';
import { NotifyContext } from '../../components/notifyContext';
import { existingTagCounts, retrieveRecentTags, tagOptions } from './tagSets';
import type { TagRow } from './tagSets';
import {
  buildTagRequests,
  COMMENT_ACTIONS,
  DETERMINATION_ACTIONS,
  DETERMINATION_CHOICES,
  defaultTagDialogInput,
  isCommentDisabled,
  isDeterminationDisabled,
  isTagsDisabled,
  modificationPreview,
  TAG_ACTIONS,
  validateTagDialog,
} from './tagDialogLogic';
import type { TagAction, TagDialogInput, TagValidation } from './tagDialogLogic';
import { TAG_DIALOG_MESSAGES } from './tagDialogMessages';
import { submitTagRequests, tagErrorMessage } from './submitTags';

export interface TagDialogProps {
  rows: readonly TagRow[];
  /** Called with the rows as they look after a successful submit (apply them to the grid). */
  onApply: (updatedRows: TagRow[]) => void | Promise<void>;
  onClose: () => void;
  call?: CallOptions;
}

function ActionSelect({
  label,
  value,
  actions,
  onChange,
}: {
  label: string;
  value: TagAction;
  actions: readonly TagAction[];
  onChange: (a: TagAction) => void;
}) {
  return (
    <TextField
      select
      size="small"
      label={label}
      value={value}
      onChange={(e) => onChange(e.target.value as TagAction)}
      sx={{ minWidth: 170 }}
    >
      {actions.map((a) => (
        <MenuItem key={a} value={a}>
          {a}
        </MenuItem>
      ))}
    </TextField>
  );
}

/**
 * "Customise Tag Events" (legacy `TagEventDialog`): determination / comment / tags, each with an
 * action. Stays open when a request fails and shows the error (BUG-26); on success hands the
 * updated rows to `onApply` (BUG-25) and closes.
 */
export function TagDialog({ rows, onApply, onClose, call }: TagDialogProps) {
  const notify = useContext(NotifyContext);
  const [input, setInput] = useState<TagDialogInput>(defaultTagDialogInput);
  const [validation, setValidation] = useState<TagValidation | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    void retrieveRecentTags().then((r) => live && setRecent(r));
    return () => {
      live = false;
    };
  }, []);

  const patch = (p: Partial<TagDialogInput>) => setInput((i) => ({ ...i, ...p }));
  const counts = useMemo(() => existingTagCounts(rows), [rows]);
  const options = useMemo(
    () => tagOptions(rows, input.tags, recent, input.tagAction === 'Remove'),
    [rows, input.tags, recent, input.tagAction],
  );
  const preview = useMemo(
    () => modificationPreview(rows, input.tagAction, input.tags),
    [rows, input.tagAction, input.tags],
  );
  const fieldErrors = validation?.fieldErrors ?? {};

  const save = async () => {
    const result = validateTagDialog(input, rows);
    setValidation(result);
    setSubmitError(null);
    if (!result.ok) return;
    const removing = input.determinationAction === 'Remove';
    const requests = buildTagRequests(rows, input);
    setSubmitting(true);
    try {
      await submitTagRequests(requests, call);
      await onApply(requests.updatedRows);
    } catch (err) {
      const message = tagErrorMessage(err);
      setSubmitError(TAG_DIALOG_MESSAGES.failed(message));
      notify?.(TAG_DIALOG_MESSAGES.failed(message));
      setSubmitting(false);
      return;
    }
    notify?.(removing ? TAG_DIALOG_MESSAGES.removed : TAG_DIALOG_MESSAGES.customised);
    onClose();
  };

  return (
    <DraggableDialog
      open
      title="Customise Tag Events"
      maxWidth="md"
      fullWidth
      onClose={(_e, reason) => {
        // Legacy dialog is persistent: only the Close button closes it.
        if (reason !== 'backdropClick' && !submitting) onClose();
      }}
      actions={
        <>
          <Button onClick={onClose} disabled={submitting}>
            Close
          </Button>
          <Button onClick={() => void save()} disabled={submitting}>
            Save
          </Button>
        </>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {rows.length} event(s) selected
      </Typography>
      <Row>
        <TextField
          select
          fullWidth
          size="small"
          label="Determination"
          value={input.determination ?? ''}
          disabled={isDeterminationDisabled(input)}
          error={Boolean(fieldErrors.determination)}
          helperText={fieldErrors.determination}
          onChange={(e) => patch({ determination: e.target.value })}
        >
          {DETERMINATION_CHOICES.map((d) => (
            <MenuItem key={d} value={d}>
              {d}
            </MenuItem>
          ))}
        </TextField>
        <ActionSelect
          label="Determination action"
          value={input.determinationAction}
          actions={DETERMINATION_ACTIONS}
          onChange={(a) => patch({ determinationAction: a })}
        />
      </Row>
      <Row>
        <TextField
          fullWidth
          size="small"
          label="Comment"
          value={input.comment ?? ''}
          disabled={isCommentDisabled(input)}
          error={Boolean(fieldErrors.comment)}
          helperText={fieldErrors.comment}
          onChange={(e) => patch({ comment: e.target.value })}
        />
        <ActionSelect
          label="Comment action"
          value={input.commentAction}
          actions={COMMENT_ACTIONS}
          onChange={(a) => patch({ commentAction: a })}
        />
      </Row>
      <Row>
        <Autocomplete<string, true, false, boolean>
          multiple
          fullWidth
          size="small"
          freeSolo={input.tagAction !== 'Remove'}
          autoSelect
          filterSelectedOptions
          options={options}
          value={[...input.tags]}
          disabled={isTagsDisabled(input)}
          onChange={(_e, value) =>
            patch({ tags: [...new Set(value.map((v) => v.trim()))].filter(Boolean) })
          }
          renderValue={(value, getItemProps) =>
            value.map((tag, index) => {
              const { key, ...props } = getItemProps({ index });
              return <Chip key={key} size="small" label={tag} {...props} />;
            })
          }
          renderOption={(props, option) => {
            const { key, ...rest } = props as typeof props & { key: string };
            const n = counts.get(option);
            return (
              <li key={key} {...rest}>
                <div>
                  <div>{option}</div>
                  {n ? (
                    <Typography variant="caption" color="text.secondary">
                      Exists in {n} event(s)
                    </Typography>
                  ) : recent.includes(option) ? (
                    <Typography variant="caption" color="text.secondary">
                      Recent tag
                    </Typography>
                  ) : null}
                </div>
              </li>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Tags"
              placeholder={input.tagAction === 'Remove' ? undefined : 'Type to add new tag...'}
            />
          )}
        />
        <ActionSelect
          label="Tag action"
          value={input.tagAction}
          actions={TAG_ACTIONS}
          onChange={(a) => patch({ tagAction: a })}
        />
      </Row>
      {validation?.errors.map((e) => (
        <Typography key={e} component="li" color="error" variant="body2" sx={{ ml: 2 }}>
          {e}
        </Typography>
      ))}
      {preview.map((m) => (
        <Typography key={m} component="li" variant="body2" sx={{ ml: 2 }}>
          {m}
        </Typography>
      ))}
      {submitError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {submitError}
        </Alert>
      )}
    </DraggableDialog>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>{children}</div>;
}
