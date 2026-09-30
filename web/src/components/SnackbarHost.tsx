import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Button from '@mui/material/Button';
import Snackbar from '@mui/material/Snackbar';
import CloseIcon from '@mui/icons-material/Close';
import InfoIcon from '@mui/icons-material/Info';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { NotifyContext, type Notify, type NotifyOptions } from './notifyContext';

/** Legacy DefaultSnackbar: default timeout and the pause between consecutive messages. */
export const DEFAULT_TIMEOUT_MS = 5000;
export const PAUSE_MS = 200;

type Item = NotifyOptions & { timeout: number };

/**
 * Provides `useNotify()` and renders one snackbar at a time from a FIFO queue.
 * Mirrors legacy DefaultSnackbar.vue: hide after `timeout`, next message after a 200 ms pause;
 * Dismiss hides immediately, then the same pause.
 */
export function SnackbarHost({ children }: { children?: ReactNode }) {
  const [current, setCurrent] = useState<Item | null>(null);
  const [open, setOpen] = useState(false);
  const queue = useRef<Item[]>([]);
  const busy = useRef(false); // a message is showing or in its pause
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNextRef = useRef<() => void>(() => undefined);

  const clearTimer = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  };

  const showNext = useCallback(() => {
    clearTimer();
    const next = queue.current.shift();
    if (!next) {
      busy.current = false;
      return;
    }
    setCurrent(next);
    setOpen(true);
    timer.current = setTimeout(() => {
      setOpen(false);
      timer.current = setTimeout(() => showNextRef.current(), PAUSE_MS);
    }, next.timeout);
  }, []);

  useEffect(() => {
    showNextRef.current = showNext;
  }, [showNext]);

  const notify = useCallback<Notify>(
    (options) => {
      const opts = typeof options === 'string' ? { message: options } : options;
      queue.current.push({ ...opts, timeout: opts.timeout ?? DEFAULT_TIMEOUT_MS });
      if (!busy.current) {
        busy.current = true;
        showNext();
      }
    },
    [showNext],
  );

  const dismiss = () => {
    clearTimer();
    setOpen(false);
    timer.current = setTimeout(() => showNextRef.current(), PAUSE_MS);
  };

  useEffect(() => clearTimer, []);

  const value = useMemo(() => notify, [notify]);

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <Snackbar
        open={open}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={
          current && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {current.icon ?? <InfoIcon color="secondary" />}
              {current.message}
            </span>
          )
        }
        action={
          current && (
            <>
              {current.link && (
                <Button
                  color="inherit"
                  size="small"
                  href={current.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<OpenInNewIcon />}
                >
                  {current.linkText ?? 'Open'}
                </Button>
              )}
              <Button color="secondary" size="small" onClick={dismiss} endIcon={<CloseIcon />}>
                Dismiss
              </Button>
            </>
          )
        }
      />
    </NotifyContext.Provider>
  );
}
