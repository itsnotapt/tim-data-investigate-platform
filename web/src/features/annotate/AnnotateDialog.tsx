import CancelIcon from '@mui/icons-material/Cancel';
import Alert from '@mui/material/Alert';
import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useState } from 'react';
import { DraggableDialog } from '../../components/DraggableDialog';
import {
  changeAnnotations,
  getTagSuggestions,
  isApiError,
  type Annotations,
  type CallOptions,
  type CatalogueAction,
  type InstanceLabel,
  type TagSuggestions,
} from '../../lib/api';
import {
  addTag,
  changeBody,
  commentStart,
  labelNow,
  NO_TAG_EDITS,
  reachLine,
  removeTag,
  replacesLine,
  suggestionGroups,
  tagChips,
  undoRemoval,
  type AnnotateMode,
  type Reach,
  type TagChip,
  type TagEdits,
} from './annotateLogic';

/** The sinks Annotate… offers to run on the rows once the change is saved. */
export interface AfterTagging {
  /** None hides the picker. */
  sinks: readonly CatalogueAction[];
  /** The key of the sink picked first: the last one run. */
  last: string | null;
  /** Why no sink can take the rows, if none can. */
  disabled: string | null;
  /** Starts `sink` on the rows. */
  run: (sink: CatalogueAction) => void;
}

export interface AnnotateDialogProps {
  /** `annotate`: label, tags and comment (Annotate…); `comment`: the comment only (Comment…). */
  mode: AnnotateMode;
  /** The distinct `id`s the change is for. */
  targets: readonly string[];
  reach: Reach;
  /** The stored annotations of those of `targets` that have any. */
  current: readonly Annotations[];
  labels: readonly InstanceLabel[];
  /** The signed-in analyst's UPN: whose comment the box edits. */
  analyst: string | null;
  /** Called with what the change changed, before the dialog closes. */
  onSaved: (changes: Annotations[]) => void | Promise<void>;
  onClose: () => void;
  /** After tagging, run…; Annotate… only. */
  afterTagging?: AfterTagging;
  call?: CallOptions;
}

/** Keep, a label key, or Clear. */
type LabelChoice = { keep: true } | { keep: false; key: string | null };
const KEEP: LabelChoice = { keep: true };
const CLEAR = 'tim:clear';
const KEEP_VALUE = 'tim:keep';
const NO_SINK = 'tim:none';

/** Waits this long after typing before asking for suggestions. */
const SUGGEST_DELAY_MS = 150;
const NO_SUGGESTIONS: TagSuggestions = { recent: [], mostUsed: [] };

const reasonOf = (e: unknown): string => {
  if (isApiError(e) && e.errors) return Object.values(e.errors).flat().join('; ');
  return e instanceof Error ? e.message : String(e);
};

function TagChipView({
  chip,
  onAdd,
  onRemove,
  onUndo,
}: {
  chip: TagChip;
  onAdd: () => void;
  onRemove: () => void;
  onUndo: () => void;
}) {
  const remove = <CancelIcon aria-label={`Remove ${chip.tag}`} />;
  switch (chip.state) {
    case 'removing':
      return (
        <Chip
          size="small"
          label={chip.tag}
          title="Removed from all: click to keep"
          onClick={onUndo}
          sx={{ textDecoration: 'line-through' }}
        />
      );
    case 'partial':
      return (
        <Chip
          size="small"
          variant="outlined"
          label={`${chip.tag} ${chip.count}/${chip.total}`}
          title={`On ${chip.count} of ${chip.total}: click to add to all`}
          onClick={onAdd}
          onDelete={onRemove}
          deleteIcon={remove}
          sx={{ borderStyle: 'dashed' }}
        />
      );
    default:
      return (
        <Chip
          size="small"
          label={chip.tag}
          onClick={() => undefined}
          onDelete={onRemove}
          deleteIcon={remove}
        />
      );
  }
}

/** A suggestion, under its group's heading. */
interface Suggestion {
  group: string;
  tag: string;
}

/**
 * The Annotate dialog: the label (Keep, a label, Clear), the tag editor with partial tags and
 * suggestions, and your comment, saved as one change, then the sink picked in After tagging, run…,
 * if any. As Comment…, the comment only. On one id the comment starts as yours, and emptying it
 * clears it; on several it starts empty, and an empty box leaves comments alone. Only the button
 * saves; a failed change keeps the dialog open with the error, and runs no sink.
 */
export function AnnotateDialog({
  mode,
  targets,
  reach,
  current,
  labels,
  analyst,
  onSaved,
  onClose,
  afterTagging,
  call,
}: AnnotateDialogProps) {
  const [label, setLabel] = useState<LabelChoice>(KEEP);
  const [edits, setEdits] = useState<TagEdits>(NO_TAG_EDITS);
  const [input, setInput] = useState('');
  const [commentBefore] = useState(() => commentStart(current, targets, analyst));
  const [comment, setComment] = useState(commentBefore);
  const [suggested, setSuggested] = useState<TagSuggestions>(NO_SUGGESTIONS);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tagging = mode === 'annotate';
  const sinks = (tagging && afterTagging?.sinks) || [];
  const sinkDisabled = afterTagging?.disabled ?? null;
  const [sinkKey, setSinkKey] = useState(afterTagging?.last ?? NO_SINK);
  const sink = sinkDisabled === null ? sinks.find((s) => s.key === sinkKey) : undefined;

  const chips = useMemo(
    () => tagChips(current, targets.length, edits),
    [current, targets.length, edits],
  );
  const suggestions = useMemo<Suggestion[]>(
    () =>
      suggestionGroups(
        input,
        chips.map((c) => c.tag),
        suggested,
      ).flatMap(({ group, tags }) => tags.map((tag) => ({ group, tag }))),
    [input, chips, suggested],
  );

  useEffect(() => {
    if (!tagging) return;
    let live = true;
    const timer = setTimeout(() => {
      getTagSuggestions(input.trim(), call).then(
        (s) => live && setSuggested(s),
        () => live && setSuggested(NO_SUGGESTIONS),
      );
    }, SUGGEST_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [input, tagging, call]);

  const choice = (pending: TagEdits) => ({
    label: label.keep ? undefined : label.key,
    edits: pending,
    comment,
    commentBefore,
  });
  // A tag still being typed is added when saving.
  const withTyped = () => (tagging ? addTag(edits, input) : edits);
  const body = changeBody(targets, choice(withTyped()));

  const save = async () => {
    const change = changeBody(targets, choice(withTyped()));
    if (change === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { changes } = await changeAnnotations(change, call);
      await onSaved(changes);
      if (sink) afterTagging?.run(sink);
      onClose();
    } catch (e) {
      setError(`Couldn't save: ${reasonOf(e)}`);
      setSaving(false);
    }
  };

  const labelValue = label.keep ? KEEP_VALUE : (label.key ?? CLEAR);

  return (
    <DraggableDialog
      open
      title={tagging ? 'Annotate' : 'Comment'}
      maxWidth="sm"
      fullWidth
      onClose={(_e, why) => {
        if (why !== 'backdropClick' && !saving) onClose();
      }}
      slotProps={{ paper: { 'aria-label': tagging ? 'Annotate' : 'Comment' } }}
      actions={
        <>
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={() => void save()} disabled={!body || saving}>
            {sink ? `Save and run ${sink.name}` : 'Save'}
          </Button>
        </>
      }
    >
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {reachLine(reach)}
      </Typography>
      {tagging && (
        <>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2">Label</Typography>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={labelValue}
              onChange={(_e, value: string | null) => {
                if (value === null) return;
                if (value === KEEP_VALUE) setLabel(KEEP);
                else setLabel({ keep: false, key: value === CLEAR ? null : value });
              }}
              aria-label="Label"
              sx={{ flexWrap: 'wrap' }}
            >
              <ToggleButton value={KEEP_VALUE}>Keep</ToggleButton>
              {labels.map((l) => (
                <ToggleButton key={l.key} value={l.key}>
                  {l.name}
                </ToggleButton>
              ))}
              <ToggleButton value={CLEAR}>Clear</ToggleButton>
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.secondary" component="p">
              {labelNow(current, targets.length, labels)}
            </Typography>
          </Box>
          <Box sx={{ mb: 2 }}>
            <Typography variant="subtitle2">Tags</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, my: 1 }}>
              {chips.map((chip) => (
                <TagChipView
                  key={chip.tag}
                  chip={chip}
                  onAdd={() => setEdits((e) => addTag(e, chip.tag))}
                  onRemove={() => setEdits((e) => removeTag(e, chip.tag, current))}
                  onUndo={() => setEdits((e) => undoRemoval(e, chip.tag))}
                />
              ))}
            </Box>
            <Autocomplete<Suggestion, false, false, true>
              freeSolo
              size="small"
              options={suggestions}
              groupBy={(s) => s.group}
              getOptionLabel={(s) => (typeof s === 'string' ? s : s.tag)}
              filterOptions={(options) => options}
              value={null}
              inputValue={input}
              onInputChange={(_e, value, reason) => {
                if (reason !== 'reset') setInput(value);
              }}
              onChange={(_e, value) => {
                if (value === null) return;
                setEdits((e) => addTag(e, typeof value === 'string' ? value : value.tag));
                setInput('');
              }}
              renderInput={(params) => (
                <TextField {...params} label="Add tag" placeholder="Type a tag, Enter to add" />
              )}
            />
          </Box>
        </>
      )}
      <TextField
        label="Comment"
        multiline
        minRows={2}
        fullWidth
        autoFocus={!tagging}
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        helperText={replacesLine(current, targets, analyst) ?? undefined}
      />
      {sinks.length > 0 && (
        <TextField
          select
          label="After tagging, run…"
          size="small"
          fullWidth
          sx={{ mt: 2 }}
          value={sink?.key ?? NO_SINK}
          onChange={(e) => setSinkKey(e.target.value)}
          disabled={sinkDisabled !== null}
          helperText={sinkDisabled ?? undefined}
        >
          <MenuItem value={NO_SINK}>None</MenuItem>
          {sinks.map((s) => (
            <MenuItem key={s.key} value={s.key}>
              {s.name}
            </MenuItem>
          ))}
        </TextField>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {error}
        </Alert>
      )}
    </DraggableDialog>
  );
}
