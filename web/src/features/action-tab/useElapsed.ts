import { useEffect, useState } from 'react';

/** The seconds since `startedAt`, ticking every second. */
export function useElapsed(startedAt: string | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (startedAt === null) return null;
  return Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
}
