import { useCallback, useEffect, useMemo, useState } from 'react';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import DeleteIcon from '@mui/icons-material/Delete';
import SearchIcon from '@mui/icons-material/Search';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import Switch from '@mui/material/Switch';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TablePagination from '@mui/material/TablePagination';
import TableRow from '@mui/material/TableRow';
import TableSortLabel from '@mui/material/TableSortLabel';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useNotify } from '../../components';
import {
  deleteTemplate,
  listTemplates,
  restoreTemplate,
  type ApiClient,
  type QueryTemplate,
} from '../../lib/api';
import { useTemplatesStore, type TemplatesStore } from '../templates';
import { describeSaveError } from './templateForm';
import { TemplateDialog } from './TemplateDialog';
import {
  filterTemplates,
  selectionCounts,
  sortTemplates,
  type SortKey,
  type SortOrder,
} from './queryManagerState';

export interface QueryManagerPageProps {
  client?: ApiClient;
  /** Templates store refreshed after every change (default: the app-wide store). */
  store?: TemplatesStore;
}

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'queryType', label: 'Type' },
  { key: 'menu', label: 'Menu text' },
  { key: 'updated', label: 'Last Updated' },
  { key: 'path', label: 'Path' },
  { key: 'cluster', label: 'Cluster' },
];

/** Legacy shows the raw UTC ISO value (F-B04); keep it verbatim. */
const formatUpdated = (iso: string): string => iso;

/** Query Manager (legacy QueryEditor): list, filter, bulk delete/restore, create/edit dialog. */
export default function QueryManagerPage({
  client,
  store = useTemplatesStore,
}: QueryManagerPageProps) {
  const notify = useNotify();
  const [templates, setTemplates] = useState<QueryTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [orderBy, setOrderBy] = useState<SortKey>('name');
  const [order, setOrder] = useState<SortOrder>('asc');
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [dialog, setDialog] = useState<{ template: QueryTemplate | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const applyList = useCallback((list: QueryTemplate[]) => {
    setTemplates(list);
    setLoadError(null);
    setSelected(new Set());
    setLoading(false);
  }, []);
  const applyError = useCallback((e: unknown) => {
    setLoadError(describeSaveError(e));
    setLoading(false);
  }, []);

  /** Reloads the list (including deleted), then the shared templates store. */
  const reload = useCallback(async () => {
    await listTemplates({ includeDeleted: true }, { client }).then(applyList, applyError);
    try {
      await store.getState().reload();
    } catch {
      // The store keeps its own `error`; the list above is what this page shows.
    }
  }, [client, store, applyList, applyError]);

  // Initial load; the store was just loaded by the bootstrap, so it is not reloaded here.
  useEffect(() => {
    const ctrl = new AbortController();
    listTemplates({ includeDeleted: true }, { client, signal: ctrl.signal }).then(
      (list) => !ctrl.signal.aborted && applyList(list),
      (e: unknown) => !ctrl.signal.aborted && applyError(e),
    );
    return () => ctrl.abort();
  }, [client, applyList, applyError]);

  const visible = useMemo(() => {
    const rows = filterTemplates(templates, search, showDeleted);
    return sortTemplates(rows, orderBy, order);
  }, [templates, search, showDeleted, orderBy, order]);

  const maxPage = Math.max(0, Math.ceil(visible.length / rowsPerPage) - 1);
  const currentPage = Math.min(page, maxPage);
  const pageRows = visible.slice(currentPage * rowsPerPage, (currentPage + 1) * rowsPerPage);

  // Only rows that are still visible count as selected.
  const selectedRows = useMemo(
    () => visible.filter((t) => selected.has(t.uuid)),
    [visible, selected],
  );
  const counts = selectionCounts(selectedRows);

  const toggle = (uuid: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(uuid)) next.add(uuid);
      return next;
    });
  const allOnPage = pageRows.length > 0 && pageRows.every((t) => selected.has(t.uuid));
  const someOnPage = pageRows.some((t) => selected.has(t.uuid));
  const togglePage = () =>
    setSelected((s) => {
      const next = new Set(s);
      for (const t of pageRows) {
        if (allOnPage) next.delete(t.uuid);
        else next.add(t.uuid);
      }
      return next;
    });

  const bulk = async (action: (uuid: string) => Promise<unknown>, rows: QueryTemplate[]) => {
    setBusy(true);
    const results = await Promise.allSettled(rows.map((t) => action(t.uuid)));
    const failed = results.find((r) => r.status === 'rejected');
    if (failed) notify(describeSaveError(failed.reason));
    await reload();
    setBusy(false);
  };

  const sortBy = (key: SortKey) => {
    setOrder(orderBy === key && order === 'asc' ? 'desc' : 'asc');
    setOrderBy(key);
  };

  return (
    <Box>
      <Typography variant="h5" component="h2" gutterBottom>
        Query Manager
      </Typography>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <Button
          variant="contained"
          size="small"
          disableElevation
          startIcon={<AddCircleIcon />}
          onClick={() => setDialog({ template: null })}
        >
          Create
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<DeleteIcon />}
          disabled={busy || counts.delete === 0 || counts.hasManaged}
          onClick={() => void bulk((u) => deleteTemplate(u, { client }), counts.deleteRows)}
        >
          Delete ({counts.delete})
        </Button>
        {showDeleted ? (
          <Button
            size="small"
            variant="outlined"
            startIcon={<AutoFixHighIcon />}
            disabled={busy || counts.restore === 0}
            onClick={() => void bulk((u) => restoreTemplate(u, { client }), counts.restoreRows)}
          >
            Restore ({counts.restore})
          </Button>
        ) : null}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
        <FormControlLabel
          control={
            <Switch checked={showDeleted} onChange={(e) => setShowDeleted(e.target.checked)} />
          }
          label="Show deleted"
        />
        <TextField
          label="Filter"
          size="small"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          sx={{ flex: 1 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
      </Box>
      {loadError ? (
        <Alert
          severity="error"
          sx={{ mb: 1, whiteSpace: 'pre-wrap' }}
          action={
            <Button color="inherit" size="small" onClick={() => void reload()}>
              Retry
            </Button>
          }
        >
          {loadError}
        </Alert>
      ) : null}
      <Table size="small" aria-label="Query templates">
        <TableHead>
          <TableRow>
            <TableCell padding="checkbox">
              <Checkbox
                checked={allOnPage}
                indeterminate={someOnPage && !allOnPage}
                onChange={togglePage}
                slotProps={{ input: { 'aria-label': 'Select all' } }}
              />
            </TableCell>
            {COLUMNS.map((c) => (
              <TableCell key={c.key} sortDirection={orderBy === c.key ? order : false}>
                <TableSortLabel
                  active={orderBy === c.key}
                  direction={orderBy === c.key ? order : 'asc'}
                  onClick={() => sortBy(c.key)}
                >
                  {c.label}
                </TableSortLabel>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {pageRows.map((t) => (
            <TableRow
              key={t.uuid}
              hover
              selected={selected.has(t.uuid)}
              sx={t.isDeleted ? { '& td': { color: 'text.disabled' }, opacity: 0.6 } : undefined}
            >
              <TableCell padding="checkbox">
                <Checkbox
                  checked={selected.has(t.uuid)}
                  onChange={() => toggle(t.uuid)}
                  slotProps={{ input: { 'aria-label': `Select ${t.name}` } }}
                />
              </TableCell>
              <TableCell>
                {t.isDeleted ? (
                  <Typography component="span" variant="body2" color="text.disabled">
                    {t.name}
                  </Typography>
                ) : (
                  <Link component="button" type="button" onClick={() => setDialog({ template: t })}>
                    {t.name}
                  </Link>
                )}
              </TableCell>
              <TableCell>{t.queryType}</TableCell>
              <TableCell>{t.menu}</TableCell>
              <TableCell>{formatUpdated(t.updated)}</TableCell>
              <TableCell>{(t.path ?? []).join(', ')}</TableCell>
              <TableCell>{t.cluster}</TableCell>
            </TableRow>
          ))}
          {pageRows.length === 0 ? (
            <TableRow>
              <TableCell colSpan={COLUMNS.length + 1} align="center">
                <Typography color="text.secondary" variant="body2">
                  {loading ? 'Loading...' : 'No data available'}
                </Typography>
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>
      <TablePagination
        component="div"
        count={visible.length}
        page={currentPage}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[10, 25, 50, 100]}
        onPageChange={(_e, p) => setPage(p)}
        onRowsPerPageChange={(e) => {
          setRowsPerPage(Number(e.target.value));
          setPage(0);
        }}
      />
      {dialog ? (
        <TemplateDialog
          template={dialog.template}
          client={client}
          onClose={() => setDialog(null)}
          onSaved={async () => {
            setDialog(null);
            await reload();
          }}
        />
      ) : null}
    </Box>
  );
}
