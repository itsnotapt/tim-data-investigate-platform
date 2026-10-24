import type { MenuItemDef } from 'ag-grid-community';
import type { Notify } from '../../components/notifyContext';

/** Copies an action file's `columns:` block `text`, and says whether it worked. */
export function copyColumnSettings(text: string, notify: Notify | null | undefined): void {
  navigator.clipboard.writeText(text).then(
    () => notify?.('Copied the column settings'),
    (e: unknown) =>
      notify?.(`Couldn't copy the column settings: ${e instanceof Error ? e.message : String(e)}`),
  );
}

/** The right-click and column menus' "Copy column settings (action file)", copying `text()`. */
export function copyColumnSettingsItem(
  text: () => string,
  notify: Notify | null | undefined,
): MenuItemDef {
  return {
    name: 'Copy column settings (action file)',
    action: () => copyColumnSettings(text(), notify),
  };
}
