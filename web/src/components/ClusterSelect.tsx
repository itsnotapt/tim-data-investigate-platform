import Autocomplete from '@mui/material/Autocomplete';
import Box from '@mui/material/Box';
import TextField from '@mui/material/TextField';
import { useMemo } from 'react';
import {
  CLUSTER_REQUIRED,
  DATABASE_REQUIRED,
  databasesFor,
  type ClusterGroup,
} from './clusterSelection';
import { normalizeClusterUrl } from './clusterUrl';
import { getConfig } from '../lib/config/runtimeConfig';

export interface ClusterSelectProps {
  cluster: string;
  database: string;
  onClusterChange: (cluster: string) => void;
  onDatabaseChange: (database: string) => void;
  /** Defaults to runtime config `defaultClusters`. */
  groups?: ClusterGroup[];
  /** Show the "required" errors (set after a failed submit); touched fields show them anyway. */
  showErrors?: boolean;
  disabled?: boolean;
}

interface ClusterOption {
  value: string;
  group: string;
}

/**
 * Cluster + database comboboxes. Both accept free text.
 * The cluster is normalised on blur/selection (`https://` prepended when missing; no forced
 * `.kusto.windows.net`).
 */
export function ClusterSelect({
  cluster,
  database,
  onClusterChange,
  onDatabaseChange,
  groups,
  showErrors = false,
  disabled,
}: ClusterSelectProps) {
  // Read config lazily so callers passing `groups` never need it.
  const effective = useMemo(() => groups ?? getConfig().defaultClusters, [groups]);
  const clusterOptions = useMemo<ClusterOption[]>(
    () => effective.flatMap((g) => g.clusters.map((value) => ({ value, group: g.name }))),
    [effective],
  );
  const databaseOptions = useMemo(() => databasesFor(effective, cluster), [effective, cluster]);

  const clusterError = showErrors && cluster.trim() === '';
  const databaseError = showErrors && database.trim() === '';

  return (
    <Box>
      <Autocomplete<ClusterOption, false, false, true>
        freeSolo
        disabled={disabled}
        options={clusterOptions}
        groupBy={(o) => o.group}
        getOptionLabel={(o) => (typeof o === 'string' ? o : o.value)}
        inputValue={cluster}
        onInputChange={(_e, v, reason) => {
          if (reason !== 'reset') onClusterChange(v);
        }}
        onChange={(_e, v) => {
          if (v !== null) onClusterChange(normalizeClusterUrl(typeof v === 'string' ? v : v.value));
        }}
        onBlur={() => {
          const n = normalizeClusterUrl(cluster);
          if (n !== cluster) onClusterChange(n);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Cluster"
            margin="normal"
            required
            error={clusterError}
            helperText={clusterError ? CLUSTER_REQUIRED : undefined}
          />
        )}
      />
      <Autocomplete<string, false, false, true>
        freeSolo
        disabled={disabled}
        options={databaseOptions}
        inputValue={database}
        onInputChange={(_e, v, reason) => {
          if (reason !== 'reset') onDatabaseChange(v);
        }}
        onChange={(_e, v) => {
          if (v !== null) onDatabaseChange(v);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Database"
            margin="normal"
            required
            error={databaseError}
            helperText={databaseError ? DATABASE_REQUIRED : undefined}
          />
        )}
      />
    </Box>
  );
}
