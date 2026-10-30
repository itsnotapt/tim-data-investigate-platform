import { useEffect, useState } from 'react';
import { getDeclareStatement, type DeclaredParameter } from '../../lib/api';

/** How long the query parameters must stay unchanged before their declare statement is asked for. */
const SETTLE_MS = 400;

/**
 * The declare statement of the action `actionKey` for `declared`, the query parameters by name
 * and type, asked of the api once they have stayed unchanged for `SETTLE_MS`. `undefined` while
 * there are none, when the action declares nothing, and when the request fails; a value change
 * asks nothing.
 */
export function useDeclareStatement(
  actionKey: string | undefined,
  declared: readonly DeclaredParameter[],
): string | undefined {
  const key =
    actionKey === undefined || declared.length === 0
      ? null
      : JSON.stringify([actionKey, declared.map(({ name, type }) => ({ name, type }))]);
  const [statement, setStatement] = useState<string>();
  // With none, the last answer is forgotten, so it doesn't show for the next query parameters.
  if (key === null && statement !== undefined) setStatement(undefined);
  useEffect(() => {
    if (key === null) return;
    const [action, parameters] = JSON.parse(key) as [string, DeclaredParameter[]];
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const settle = (statement: string | undefined) => {
        if (!controller.signal.aborted) setStatement(statement);
      };
      getDeclareStatement(action, parameters, { signal: controller.signal }).then(settle, () =>
        settle(undefined),
      );
    }, SETTLE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [key]);
  // The last answer stays on show while the next one is asked for.
  return statement;
}
