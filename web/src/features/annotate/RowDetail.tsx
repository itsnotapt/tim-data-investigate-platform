import CloseIcon from '@mui/icons-material/Close';
import ContentCopy from '@mui/icons-material/ContentCopy';
import ExpandMore from '@mui/icons-material/ExpandMore';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useContext, useEffect, useState, type KeyboardEvent } from 'react';
import { create } from 'zustand';
import { NotifyContext } from '../../components/notifyContext';
import {
  changeAnnotations,
  getAnnotationHistory,
  isApiError,
  type Annotations,
  type CallOptions,
  type HistoryEntry,
  type InstanceLabel,
} from '../../lib/api';
import { formatUtcDate, formatUtcTime } from '../../lib/utcFormat';
import { detailEntries, type DetailColumns, type DetailEntry } from '../grid';
import { shownLabel, targetIds, whyUnlabellable, type LabelledRow } from '../labels';

const ROW_DETAIL_WIDTH = 900;
const NAME_WIDTH = 210;
const MONO = 'ui-monospace, "Cascadia Mono", "SF Mono", Consolas, "Roboto Mono", monospace';

export interface RowDetailProps {
  /** The focused row: its `id` and its fields. */
  row: LabelledRow | null;
  /** The stored annotations of the row's `id`, if any. */
  annotations: Annotations | null;
  labels: readonly InstanceLabel[];
  /** The run's columns: the order of the fields. */
  columns: DetailColumns;
  /** The action takes its rows' id from an Id column param. */
  idParam: boolean;
  /** Called with what a comment added from the panel changed. */
  onCommented: (changes: Annotations[]) => void | Promise<void>;
  onClose: () => void;
  call?: CallOptions;
}

const formatAt = (at: string) => {
  const d = new Date(at);
  return `${formatUtcDate(d)} ${formatUtcTime(d)} UTC`;
};

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

/** Shows on hover or keyboard focus of what holds it (`COPY_SHOWN`). */
function CopyButton({ text, name }: { text: string; name: string }) {
  const notify = useContext(NotifyContext);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      notify?.(`Copied ${name}`);
    } catch {
      notify?.(`Couldn't copy ${name}`);
    }
  };
  return (
    <IconButton
      className="copy"
      size="small"
      aria-label={`Copy ${name}`}
      title={`Copy ${name}`}
      onClick={() => void copy()}
      sx={{ opacity: 0, p: '2px', flexShrink: 0, '&:focus-visible': { opacity: 1 } }}
    >
      <ContentCopy sx={{ fontSize: 14 }} />
    </IconButton>
  );
}

const COPY_SHOWN = { '&:hover .copy, &:focus-within .copy': { opacity: 1 } };

/** An object's lines: keys and dashes secondary, typed values in the info colour. */
function ObjectLines({ lines }: { lines: NonNullable<DetailEntry['lines']> }) {
  return lines.map((line, i) => (
    // A line that wraps carries on 2 characters in from where it started.
    <Box key={i} sx={{ pl: `${line.indent + 2}ch`, textIndent: '-2ch' }}>
      {line.segments.map((segment, j) => (
        <Box
          component="span"
          key={j}
          sx={{
            color:
              segment.kind === 'key'
                ? 'text.secondary'
                : segment.kind === 'typed'
                  ? 'info.main'
                  : undefined,
          }}
        >
          {segment.text}
        </Box>
      ))}
    </Box>
  ));
}

/** A value over `CLAMP_CHARACTERS` characters or `CLAMP_LINES` lines shows its first lines. */
const CLAMP_CHARACTERS = 180;
const CLAMP_LINES = 3;

/** A field's value; a long one is clamped, with Show all and Show less. */
function Value({ entry }: { entry: DetailEntry }) {
  const [all, setAll] = useState(false);
  const long = entry.text.length > CLAMP_CHARACTERS || entry.text.split('\n').length > CLAMP_LINES;
  return (
    <Box
      sx={{
        flex: 1,
        minWidth: 0,
        ...(entry.technical
          ? { fontFamily: MONO, fontSize: 12.5, lineHeight: 1.5 }
          : { fontSize: 13, lineHeight: 1.45 }),
      }}
    >
      <Box
        sx={{
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
          ...(long && !all
            ? {
                display: '-webkit-box',
                WebkitLineClamp: CLAMP_LINES,
                WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }
            : {}),
        }}
      >
        {entry.lines ? <ObjectLines lines={entry.lines} /> : entry.text}
      </Box>
      {long && (
        <Link
          component="button"
          variant="caption"
          onClick={() => setAll((a) => !a)}
          sx={{ fontFamily: 'inherit' }}
        >
          {all ? 'Show less' : `Show all (${entry.text.length.toLocaleString('en-US')} characters)`}
        </Link>
      )}
    </Box>
  );
}

/** The row's fields: names left, values right. */
function Fields({ row, columns }: { row: LabelledRow | null; columns: RowDetailProps['columns'] }) {
  const entries = detailEntries(row?.data as Record<string, unknown> | undefined, columns);
  return (
    <Box component="section" aria-label="Fields">
      <Box
        component="dl"
        // Another row starts with every value clamped.
        key={row?.row}
        sx={{ display: 'grid', gridTemplateColumns: `${NAME_WIDTH}px minmax(0, 1fr)`, m: 0 }}
      >
        {entries.map((entry) => (
          <Box
            key={entry.key}
            sx={{ display: 'contents', '&:hover > *': { bgcolor: 'action.hover' }, ...COPY_SHOWN }}
          >
            <Box
              component="dt"
              sx={{
                fontSize: 12,
                fontWeight: 500,
                color: 'text.secondary',
                lineHeight: 1.6,
                py: '2px',
                pl: 0.5,
                pr: 1,
                overflowWrap: 'anywhere',
              }}
            >
              {entry.key}
            </Box>
            <Box
              component="dd"
              sx={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 0.5,
                py: '2px',
                m: 0,
                minWidth: 0,
              }}
            >
              <Value entry={entry} />
              <CopyButton text={entry.copy} name={entry.key} />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** The `id`, its label with its colour, who set it and when, and its tags. */
function Annotated({
  id,
  annotations,
  labels,
}: {
  id: string;
  annotations: Annotations | null;
  labels: readonly InstanceLabel[];
}) {
  const label = annotations?.label ?? null;
  const shown = label && shownLabel(label.key, labels);
  const tags = annotations?.tags ?? [];
  return (
    <>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ...COPY_SHOWN }}>
        <Typography
          component="code"
          sx={{ fontFamily: MONO, fontSize: 13, overflowWrap: 'anywhere' }}
        >
          {id}
        </Typography>
        <CopyButton text={id} name="id" />
      </Box>
      {label && shown ? (
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
          <Box
            sx={{
              width: 10,
              height: 10,
              borderRadius: '2px',
              alignSelf: 'center',
              bgcolor: `var(--mui-palette-labelStripe-${shown.colour})`,
            }}
          />
          <Typography variant="subtitle2">{shown.name}</Typography>
          <Typography variant="caption" color="text.secondary">
            {`${label.by} · ${formatAt(label.at)}`}
          </Typography>
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No label
        </Typography>
      )}
      {tags.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {tags.map((tag) => (
            <Chip key={tag} size="small" label={tag} />
          ))}
        </Box>
      )}
    </>
  );
}

/** Each history entry, newest first: a label change as "old → new", a comment as is. */
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
          return (
            <Box component="li" key={i} sx={{ mb: 1.25 }}>
              <Typography variant="caption" color="text.secondary" component="div">
                {`${entry.author} · ${formatAt(entry.at)}`}
              </Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>
                {entry.text}
              </Typography>
            </Box>
          );
        }
        const older = entries.slice(i + 1).find((e) => e.kind === 'label');
        const before = older?.kind === 'label' ? older.label : null;
        return (
          <Box component="li" key={i} sx={{ mb: 1.25 }}>
            <Typography variant="caption" color="text.secondary">
              {`${labelName(before)} → ${labelName(entry.label)} · ${entry.by} · ${formatAt(entry.at)}`}
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

/** The comment box (Ctrl or Cmd+Enter adds), then the history of `id`, under a heading that folds. */
function CommentsAndHistory({
  id,
  version,
  labels,
  comment,
  setComment,
  onCommented,
  call,
}: {
  id: string;
  version: number | undefined;
  labels: readonly InstanceLabel[];
  /** The comment typed so far. */
  comment: string;
  setComment: (text: string) => void;
  onCommented: RowDetailProps['onCommented'];
  call?: CallOptions;
}) {
  const { entries, error, reload } = useHistory(id, version, call);
  const { folded, setFolded } = useFold();
  const [commentError, setCommentError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const addComment = async () => {
    const text = comment.trim();
    if (text === '' || saving) return;
    setSaving(true);
    setCommentError(null);
    try {
      const { changes } = await changeAnnotations({ ids: [id], comment: text }, call);
      await onCommented(changes);
      setComment('');
      reload();
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
              {`${plural(entries.filter((e) => e.kind === 'comment').length, 'comment', 'comments')} · ${plural(entries.length, 'entry', 'entries')}`}
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
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={onKeyDown}
              helperText="Ctrl+Enter adds"
            />
            <Box sx={{ textAlign: 'right', mt: -2.5 }}>
              <Button
                size="small"
                onClick={() => void addComment()}
                disabled={comment.trim() === '' || saving}
              >
                Add comment
              </Button>
            </Box>
            {commentError && <Alert severity="error">{commentError}</Alert>}
          </Box>
          {error && <Alert severity="error">{error}</Alert>}
          {entries && <HistoryItems entries={entries} labels={labels} />}
        </Box>
      )}
    </Box>
  );
}

/**
 * Row detail: the focused row's fields and, when it has an `id`, its label, tags, a comment box and
 * its history. A row without an `id` shows why it has no annotations, as the menu does.
 * Persistent and absolutely positioned in the grid's container, 900px wide and capped at it.
 */
export function RowDetail({
  row,
  annotations,
  labels,
  columns,
  idParam,
  onCommented,
  onClose,
  call,
}: RowDetailProps) {
  const id = row?.id ?? null;
  // Half-typed comments by id, kept while the panel is open.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
        // The root needs the width: the absolutely positioned paper resolves its percentages
        // against it.
        width: ROW_DETAIL_WIDTH,
        maxWidth: '100%',
        zIndex: 3,
        pointerEvents: 'none',
      }}
      slotProps={{
        paper: { sx: { position: 'absolute', width: '100%', pointerEvents: 'auto' } },
      }}
    >
      <Box
        component="aside"
        aria-label="Row detail"
        sx={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Typography variant="subtitle1" component="h2" sx={{ fontWeight: 500 }}>
            Row detail
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ flex: 1 }}>
            {`${row ? `row ${row.row} · ` : ''}D closes · ↑↓ move rows`}
          </Typography>
          <IconButton size="small" aria-label="Close row detail" onClick={onClose}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
        <Box
          sx={{
            px: 2,
            py: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.5,
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'action.hover',
          }}
        >
          {id === null ? (
            <Alert severity="info" variant="outlined" sx={{ py: 0, fontSize: 13 }}>
              {whyUnlabellable(targetIds(row ? [row] : []), Infinity, idParam)}
            </Alert>
          ) : (
            <Annotated id={id} annotations={annotations} labels={labels} />
          )}
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1 }}>
          <Fields row={row} columns={columns} />
          {id !== null && (
            <CommentsAndHistory
              // Another id starts with its own history and no error.
              key={id}
              id={id}
              version={annotations?.version}
              labels={labels}
              comment={drafts[id] ?? ''}
              setComment={(text) => setDrafts((d) => ({ ...d, [id]: text }))}
              onCommented={onCommented}
              call={call}
            />
          )}
        </Box>
      </Box>
    </Drawer>
  );
}
