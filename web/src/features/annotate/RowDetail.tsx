import CloseIcon from '@mui/icons-material/Close';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Drawer from '@mui/material/Drawer';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import type { Annotations, CallOptions, InstanceLabel } from '../../lib/api';
import { formatUtcDateTime } from '../../lib/utcFormat';
import type { DetailColumns } from '../grid';
import { shownLabel, targetIds, whyUnlabellable, type LabelledRow } from '../labels';
import { CommentsAndHistory, type CommentsAndHistoryProps } from './CommentsAndHistory';
import { CopyButton } from './CopyButton';
import { COPY_SHOWN, MONO } from './rowDetailStyles';
import { RowFields } from './RowFields';

const ROW_DETAIL_WIDTH = 900;

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
  /** The name the API knows the signed-in analyst by: whose comment the panel edits. */
  analyst: string | null;
  /** Called with what a comment saved from the panel changed. */
  onCommented: CommentsAndHistoryProps['onCommented'];
  onClose: () => void;
  call?: CallOptions;
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
            {`${label.by} · ${formatUtcDateTime(label.at)}`}
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
  analyst,
  onCommented,
  onClose,
  call,
}: RowDetailProps) {
  const id = row?.id ?? null;
  // Half-typed comments by id, kept while the panel is open.
  const [drafts, setDrafts] = useState<Record<string, string | undefined>>({});
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
          <RowFields row={row} columns={columns} />
          {id !== null && (
            <CommentsAndHistory
              // Another id starts with its own history and no error.
              key={id}
              id={id}
              version={annotations?.version}
              labels={labels}
              comments={annotations?.comments ?? []}
              analyst={analyst}
              comment={drafts[id]}
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
