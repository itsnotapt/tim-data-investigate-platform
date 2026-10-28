import ExpandMore from '@mui/icons-material/ExpandMore';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import {
  changeAnnotations,
  getAnnotationHistory,
  isApiError,
  type Annotations,
  type CallOptions,
  type Comment,
  type HistoryEntry,
  type InstanceLabel,
} from '../../lib/api';
import { formatUtcDateTime } from '../../lib/utcFormat';
import { shownLabel } from '../labels';

export interface CommentsAndHistoryProps {
  id: string;
  /** The `id`'s annotations version: a new one reads the history again. */
  version: number | undefined;
  labels: readonly InstanceLabel[];
  /** The `id`'s current comments, one per author. */
  comments: readonly Comment[];
  /** The signed-in analyst's UPN: whose comment the box edits. */
  analyst: string | null;
  /** The comment typed so far; `undefined` until the box is edited, when it shows yours. */
  comment: string | undefined;
  setComment: (text: string | undefined) => void;
  /** Called with what a saved comment changed. */
  onCommented: (changes: Annotations[]) => void | Promise<void>;
  call?: CallOptions;
}

const reasonOf = (e: unknown): string => {
  if (isApiError(e) && e.errors) return Object.values(e.errors).flat().join('; ');
  return e instanceof Error ? e.message : String(e);
};

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The history of `id`, read again when its `version` changes and on `reload`. */
function useHistory(id: string, version: number | undefined, call?: CallOptions) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  useEffect(() => {
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
  }, [id, version, reloads, call]);
  return { entries, error, reload: () => setReloads((n) => n + 1) };
}

/**
 * Each history entry, newest first: a label change as "old → new", a comment as is. A comment its
 * author later replaced reads as edited, and an empty one as cleared.
 */
function HistoryItems({
  entries,
  labels,
}: {
  entries: readonly HistoryEntry[];
  labels: readonly InstanceLabel[];
}) {
  const labelName = (key: string | null) =>
    key === null ? 'No label' : shownLabel(key, labels).name;
  if (entries.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        No history yet.
      </Typography>
    );
  }
  return (
    <Box component="ul" aria-label="History" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {entries.map((entry, i) => {
        if (entry.kind === 'comment') {
          const edited = entries
            .slice(0, i)
            .some((e) => e.kind === 'comment' && e.author === entry.author);
          const state = entry.text === '' ? ' · cleared their comment' : edited ? ' · edited' : '';
          return (
            <Box component="li" key={i} sx={{ mb: 1.25 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {`${entry.author} · ${formatUtcDateTime(entry.at)}${state}`}
              </Typography>
              {entry.text !== '' && (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                  {entry.text}
                </Typography>
              )}
            </Box>
          );
        }
        const older = entries.slice(i + 1).find((e) => e.kind === 'label');
        const before = older?.kind === 'label' ? older.label : null;
        return (
          <Box component="li" key={i} sx={{ mb: 1.25 }}>
            <Typography variant="caption" color="text.secondary">
              {`${labelName(before)} → ${labelName(entry.label)} · ${entry.by} · ${formatUtcDateTime(entry.at)}`}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

/** Whether Comments and history is folded, in every panel, for as long as the page is open. */
const useFold = create<{ folded: boolean; setFolded: (folded: boolean) => void }>((set) => ({
  folded: false,
  setFolded: (folded) => set({ folded }),
}));

/** The other authors' current comments, read-only, each with its author and time. */
function OtherComments({ comments }: { comments: readonly Comment[] }) {
  if (comments.length === 0) return null;
  return (
    <Box component="ul" aria-label="Other comments" sx={{ listStyle: 'none', p: 0, m: 0 }}>
      {comments.map((c) => (
        <Box component="li" key={c.author} sx={{ mb: 1.25 }}>
          <Typography variant="caption" color="text.secondary" component="div">
            {`${c.author} · ${formatUtcDateTime(c.at)}`}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
            {c.text}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

/**
 * Your comment on `id`, which Save replaces and saving empty clears, the others' comments, then the
 * history of `id`, under a heading that folds.
 */
export function CommentsAndHistory({
  id,
  version,
  labels,
  comments,
  analyst,
  comment,
  setComment,
  onCommented,
  call,
}: CommentsAndHistoryProps) {
  const { entries, error, reload } = useHistory(id, version, call);
  const { folded, setFolded } = useFold();
  const [commentError, setCommentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const mine = comments.find((c) => c.author === analyst)?.text ?? '';
  const others = comments.filter((c) => c.author !== analyst);
  const text = comment ?? mine;
  const unchanged = text.trim() === mine;

  const save = async () => {
    if (unchanged || saving) return;
    setSaving(true);
    setCommentError(null);
    try {
      const trimmed = text.trim();
      const { changes } = await changeAnnotations(
        { ids: [id], comment: trimmed === '' ? null : trimmed },
        call,
      );
      await onCommented(changes);
      setComment(undefined);
      reload();
    } catch (e) {
      setCommentError(`Couldn't save the comment: ${reasonOf(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Box component="section" aria-label="Comments and history" sx={{ mt: 2, mb: 8 }}>
      <Box component="h3" sx={{ m: 0 }}>
        <Box
          component="button"
          aria-expanded={!folded}
          onClick={() => setFolded(!folded)}
          sx={{
            all: 'unset',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            width: '100%',
            color: 'text.secondary',
            '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main' },
          }}
        >
          <ExpandMore
            fontSize="small"
            sx={{ transform: folded ? 'rotate(-90deg)' : 'none', transition: 'transform 120ms' }}
          />
          <Typography variant="overline" sx={{ lineHeight: 2 }}>
            Comments and history
          </Typography>
          {entries && (
            <Typography variant="caption" sx={{ ml: 1 }}>
              {`${plural(comments.length, 'comment', 'comments')} · ${plural(entries.length, 'entry', 'entries')}`}
            </Typography>
          )}
        </Box>
      </Box>
      {!folded && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
          <Box>
            <TextField
              label="Comment"
              multiline
              minRows={2}
              fullWidth
              size="small"
              value={text}
              onChange={(e) => setComment(e.target.value)}
            />
            <Box sx={{ textAlign: 'right' }}>
              <Button size="small" onClick={() => void save()} disabled={unchanged || saving}>
                Save
              </Button>
            </Box>
            {commentError && <Alert severity="error">{commentError}</Alert>}
          </Box>
          <OtherComments comments={others} />
          {error && <Alert severity="error">{error}</Alert>}
          {entries && <HistoryItems entries={entries} labels={labels} />}
        </Box>
      )}
    </Box>
  );
}
