import Box from '@mui/material/Box';
import Link from '@mui/material/Link';
import { useState } from 'react';
import { detailEntries, type DetailColumns, type DetailEntry } from '../grid';
import type { LabelledRow } from '../labels';
import { CopyButton } from './CopyButton';
import { COPY_SHOWN, MONO } from './rowDetailStyles';

const NAME_WIDTH = 210;

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
        fontFamily: MONO,
        fontSize: 12.5,
        lineHeight: 1.5,
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

/** The row's fields in the order of `columns`: names left, values right, each with a copy button. */
export function RowFields({ row, columns }: { row: LabelledRow | null; columns: DetailColumns }) {
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
