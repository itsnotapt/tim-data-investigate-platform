import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState, type KeyboardEvent } from 'react';
import {
  changeAnnotations,
  getAnnotationHistory,
  isApiError,
  type Annotations,
  type CallOptions,
  type HistoryEntry,
  type InstanceLabel,
} from '../../lib/api';
import { formatUtcDate, formatUtcTime } from '../../lib/time-range';
import { detailEntries } from '../grid/detailText';
import { shownLabel, type LabelledRow } from '../labels';

const HISTORY_PANEL_WIDTH = 480;

export interface HistoryPanelProps {
  /** The focused row: its `id` and its fields. */
  row: LabelledRow | null;
  /** The stored annotations of the row's `id`, if any. */
  annotations: Annotations | null;
  labels: readonly InstanceLabel[];
  /** Called with what a comment added from the panel changed. */
  onCommented: (changes: Annotations[]) => void | Promise<void>;
  onClose: () => void;
  call?: CallOptions;
}

const when = (at: string) => {
  const d = new Date(at);
  return `${formatUtcDate(d)} ${formatUtcTime(d)} UTC`;
};

const reasonOf = (e: unknown): string => {
  if (isApiError(e) && e.errors) return Object.values(e.errors).flat().join('; ');
  return e instanceof Error ? e.message : String(e);
};

/** Each history entry's line, newest first: a label change as "old → new", a comment as is. */
function HistoryItems({
  entries,
  labels,
}: {
  entries: readonly HistoryEntry[];
  labels: readonly InstanceLabel[];
}) {
  const name = (key: string | null) => (key === null ? 'No label' : shownLabel(key, labels).name);
  return (
    <Box component="ul" aria-label="History" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {entries.map((entry, i) => {
        if (entry.kind === 'comment') {
          return (
            <Box component="li" key={i} sx={{ mb: 1.5 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {`${entry.author} · ${when(entry.at)}`}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {entry.text}
              </Typography>
            </Box>
          );
        }
        const older = entries.slice(i + 1).find((e) => e.kind === 'label');
        const before = older?.kind === 'label' ? older.label : null;
        return (
          <Box component="li" key={i} sx={{ mb: 1.5 }}>
            <Typography variant="body2" color="text.secondary">
              {`${name(before)} → ${name(entry.label)} · ${entry.by} · ${when(entry.at)}`}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * The History side panel of the focused row: the `id`, its label with who and when, its tags, its
 * comment box (Ctrl+Enter adds), its history newest first, then the row's fields. Persistent and absolutely positioned in the grid's
 * container, like the detail panel.
 */
export function HistoryPanel({
  row,
  annotations,
  labels,
  onCommented,
  onClose,
  call,
}: HistoryPanelProps) {
  const id = row?.id ?? null;
  const version = annotations?.version;
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a comment from the panel, to read the history again.
  const [read, setRead] = useState(0);
  const [comment, setComment] = useState('');
  const [commentError, setCommentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id === null) return;
    let live = true;
    getAnnotationHistory(id, call).then(
      (h) => {
        if (!live) return;
        setEntries(h.entries);
        setError(null);
      },
      (e: unknown) => live && setError(`Couldn't load the history: ${reasonOf(e)}`),
    );
    return () => {
      live = false;
    };
  }, [id, version, read, call]);

  const addComment = async () => {
    const text = comment.trim();
    if (id === null || text === '' || saving) return;
    setSaving(true);
    setCommentError(null);
    try {
      const { changes } = await changeAnnotations({ ids: [id], comment: text }, call);
      await onCommented(changes);
      setComment('');
      setRead((n) => n + 1);
    } catch (e) {
      setCommentError(`Couldn't add the comment: ${reasonOf(e)}`);
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void addComment();
    }
  };

  const label = annotations?.label ?? null;
  return (
    <Drawer
      variant="persistent"
      anchor="right"
      open
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: HISTORY_PANEL_WIDTH,
        maxWidth: '100%',
        zIndex: 3,
        pointerEvents: 'none',
      }}
      slotProps={{
        paper: { sx: { position: 'absolute', width: '100%', pointerEvents: 'auto', p: 2 } },
      }}
    >
      <Box component="aside" aria-label="History">
        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Typography variant="h6" sx={{ flex: 1 }}>
            History
          </Typography>
          <IconButton aria-label="Close history" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        </Box>
        {id === null ? (
          <Typography variant="body2">This row has no id.</Typography>
        ) : (
          <>
            <Typography component="code" sx={{ overflowWrap: 'anywhere' }}>
              {id}
            </Typography>
            <Box sx={{ my: 1 }}>
              {label ? (
                <>
                  <Typography variant="subtitle2">{shownLabel(label.key, labels).name}</Typography>
                  <Typography variant="caption" color="text.secondary">
                    {`${label.by} · ${when(label.at)}`}
                  </Typography>
                </>
              ) : (
                <Typography variant="subtitle2">No label</Typography>
              )}
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mb: 2 }}>
              {(annotations?.tags ?? []).map((tag) => (
                <Chip key={tag} size="small" label={tag} />
              ))}
            </Box>
            <TextField
              label="Comment"
              multiline
              minRows={2}
              fullWidth
              size="small"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={onKeyDown}
              helperText="Ctrl+Enter adds"
            />
            <Box sx={{ textAlign: 'right', mb: 2 }}>
              <Button
                size="small"
                onClick={() => void addComment()}
                disabled={comment.trim() === '' || saving}
              >
                Add comment
              </Button>
            </Box>
            {commentError && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {commentError}
              </Alert>
            )}
            {error && (
              <Alert severity="error" sx={{ mb: 2 }}>
                {error}
              </Alert>
            )}
            {entries && <HistoryItems entries={entries} labels={labels} />}
          </>
        )}
        <Box component="section" aria-label="Fields" sx={{ mt: 2 }}>
          <Typography variant="subtitle2">Fields</Typography>
          <Box
            component="dl"
            sx={{ display: 'grid', gridTemplateColumns: '160px auto', fontSize: '0.9rem', m: 0 }}
          >
            {detailEntries(row?.data as Record<string, unknown> | undefined).map(
              ({ key, text }) => (
                <Box key={key} sx={{ display: 'contents' }}>
                  <Box component="dt" sx={{ mt: '5px', fontWeight: 500, overflowWrap: 'anywhere' }}>
                    {key}
                  </Box>
                  <Box
                    component="dd"
                    sx={{
                      m: 0,
                      mt: '5px',
                      pl: '10px',
                      overflowWrap: 'anywhere',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {text}
                  </Box>
                </Box>
              ),
            )}
          </Box>
        </Box>
      </Box>
    </Drawer>
  );
}
