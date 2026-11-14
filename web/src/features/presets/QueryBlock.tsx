import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useId } from 'react';

/** The dark block the query sits in. */
const block = {
  m: 0,
  py: 1,
  bgcolor: 'code.background',
  color: 'code.text',
  borderRadius: 1,
  fontFamily: 'Consolas, Menlo, monospace',
  fontSize: 13,
  lineHeight: '20px',
  maxHeight: 220,
} as const;

/**
 * A query as an editor shows it, dark with line numbers. The declare statement, if any, is its
 * first line, highlighted, with a note under the block that it is added from the query parameters.
 * With neither a query nor a declare statement, it says there is no query yet.
 */
export function QueryBlock({
  query,
  declareStatement,
}: {
  query: string;
  declareStatement?: string;
}) {
  const noteId = useId();
  const lines = [
    ...(declareStatement ? [{ text: declareStatement, added: true }] : []),
    ...(query === '' ? [] : query.split('\n')).map((text) => ({ text, added: false })),
  ];
  if (lines.length === 0) {
    return (
      <Box sx={{ ...block, px: 1.5, color: 'code.lineNumber', fontStyle: 'italic' }}>
        No query yet
      </Box>
    );
  }
  return (
    <div>
      <Box
        component="ol"
        aria-label="Query"
        sx={{ ...block, px: 0, listStyle: 'none', counterReset: 'line', overflow: 'auto' }}
      >
        {lines.map((line, i) => (
          <Box
            component="li"
            key={i}
            aria-describedby={line.added ? noteId : undefined}
            sx={{
              display: 'flex',
              whiteSpace: 'pre',
              counterIncrement: 'line',
              borderLeft: 3,
              borderColor: line.added ? 'code.added' : 'transparent',
              bgcolor: line.added ? 'code.addedBackground' : undefined,
              color: line.added ? 'code.addedText' : undefined,
              '&::before': {
                content: 'counter(line)',
                width: 36,
                flexShrink: 0,
                pr: 1.5,
                textAlign: 'right',
                color: 'code.lineNumber',
              },
            }}
          >
            {line.text}
          </Box>
        ))}
      </Box>
      {declareStatement && (
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', mt: 0.5 }}>
          <Box sx={{ width: 10, height: 10, bgcolor: 'code.added', borderRadius: 0.5 }} />
          <Typography id={noteId} variant="caption" color="text.secondary">
            Line 1 is added from the query parameters
          </Typography>
        </Stack>
      )}
    </div>
  );
}
