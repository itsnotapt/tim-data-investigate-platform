import EditIcon from '@mui/icons-material/Edit';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import ButtonBase from '@mui/material/ButtonBase';
import Popover from '@mui/material/Popover';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import { useState, type FormEvent } from 'react';
import type { CatalogueAction } from '../../lib/api';
import type { TabContent } from '../../lib/storage';
import { TitleTemplateField } from '../presets/TitleTemplateField';
import { shownTitle, titleOf, titleTemplateOf, titleValuesOf } from './model';
import { isParametersParam, queryParameters } from './queryParameters';
import { pivotRowColumns, unnamedError } from './titleTemplate';

export interface TabTitleProps {
  tab: TabContent;
  /** The tab's action; none when it is gone from the instance. */
  action: CatalogueAction | undefined;
  /** With the tab's new title template. */
  onRename: (template: string) => void;
}

/**
 * The names a placeholder of the tab's title template can hold besides `row.` and a column: the
 * params of its action and its own, and its query parameters.
 */
function renameNames(tab: TabContent, action: CatalogueAction | undefined): Set<string> {
  const { params } = tab.toRun;
  return new Set([
    ...(action?.params ?? []).map((p) => p.name),
    ...Object.keys(params),
    ...queryParameters(params.parameters).map((qp) => qp.name),
  ]);
}

/**
 * The placeholders the Tab title suggests, each once, in order: the params, with the query
 * parameters in place of `parameters`, then `row.` and each column of the tab's pivot rows.
 */
function renameSuggestions(
  tab: TabContent,
  action: CatalogueAction | undefined,
  pivotRows: readonly Record<string, unknown>[],
): string[] {
  const { params } = tab.toRun;
  const paramNames = action
    ? action.params.filter((p) => !isParametersParam(p)).map((p) => p.name)
    : Object.keys(params).filter((name) => name !== 'parameters');
  return [
    ...new Set([
      ...paramNames,
      ...queryParameters(params.parameters).map((qp) => qp.name),
      ...pivotRowColumns(pivotRows).map((column) => `row.${column}`),
    ]),
  ];
}

/** The box under the title: the Tab title field, what it shows as, and Cancel and Rename. */
function RenameBox({
  tab,
  action,
  anchor,
  onRename,
  onClose,
}: TabTitleProps & { anchor: HTMLElement; onClose: () => void }) {
  const [template, setTemplate] = useState(() => titleTemplateOf(tab, action));
  const pivotRows = titleValuesOf(tab).pivotRows ?? [];
  const suggestions = renameSuggestions(tab, action, pivotRows);
  const names = renameNames(tab, action);
  const error = unnamedError(template, names);
  const canRename = template.trim() !== '' && error === undefined;
  const [first] = suggestions;
  const example = `e.g. ${action?.name ?? tab.title}${first === undefined ? '' : ` for {${first}}`}`;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canRename) return;
    onRename(template);
    onClose();
  };

  return (
    <Popover
      open
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      slotProps={{
        paper: { role: 'dialog', 'aria-label': 'Rename tab', sx: { p: 2, width: 480 } },
      }}
    >
      <Stack component="form" spacing={1.5} onSubmit={submit} noValidate>
        <TitleTemplateField
          value={template}
          onChange={setTemplate}
          names={names}
          suggestions={suggestions}
          pivotRows={pivotRows}
          example={example}
          error={error}
        />
        <Typography variant="body2" color="text.secondary" noWrap>
          Shows as:{' '}
          <Box component="b" sx={{ color: 'text.primary' }}>
            {error === undefined ? shownTitle(tab, template, action) : '—'}
          </Box>
        </Typography>
        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={!canRename}>
            Rename
          </Button>
        </Stack>
      </Stack>
    </Popover>
  );
}

/**
 * The tab's title in the app bar: a button, with a pencil on hover, that opens the box to rename
 * the tab under it.
 */
export function TabTitle({ tab, action, onRename }: TabTitleProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const title = titleOf(tab);
  return (
    <>
      <Typography variant="subtitle1" component="h2" noWrap sx={{ fontWeight: 500, minWidth: 0 }}>
        <Tooltip title="Rename" describeChild>
          <ButtonBase
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{
              font: 'inherit',
              maxWidth: '100%',
              gap: 0.5,
              px: 0.5,
              borderRadius: 1,
              '&:hover, &.Mui-focusVisible': { bgcolor: 'action.hover' },
              '& .pencil': { opacity: 0 },
              '&:hover .pencil, &.Mui-focusVisible .pencil': { opacity: 1 },
            }}
          >
            <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {title}
            </Box>
            <EditIcon className="pencil" fontSize="inherit" aria-hidden />
          </ButtonBase>
        </Tooltip>
      </Typography>
      {anchor && (
        <RenameBox
          tab={tab}
          action={action}
          anchor={anchor}
          onRename={onRename}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
