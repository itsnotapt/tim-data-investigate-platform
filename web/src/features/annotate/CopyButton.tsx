import ContentCopy from '@mui/icons-material/ContentCopy';
import IconButton from '@mui/material/IconButton';
import { useContext } from 'react';
import { NotifyContext } from '../../components/notifyContext';

/** Copies `text`, with a toast naming `name`. Hidden until what holds it has `COPY_SHOWN`. */
export function CopyButton({ text, name }: { text: string; name: string }) {
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
