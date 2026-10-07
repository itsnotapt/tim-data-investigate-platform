import { normalizeClusterUrl } from './clusterUrl';

export interface ClusterGroup {
  name: string;
  clusters: string[];
  databases: string[];
}

export const CLUSTER_REQUIRED = 'Cluster is required';
export const DATABASE_REQUIRED = 'Database is required';

/** Required-field rules. Empty array when valid. */
export function validateClusterSelection(cluster: string, database: string): string[] {
  const errors: string[] = [];
  if (cluster.trim() === '') errors.push(CLUSTER_REQUIRED);
  if (database.trim() === '') errors.push(DATABASE_REQUIRED);
  return errors;
}

/** Databases of the group that lists `cluster` (compared after normalisation). */
export function databasesFor(groups: ClusterGroup[], cluster: string): string[] {
  const wanted = normalizeClusterUrl(cluster);
  if (wanted === '') return [];
  const group = groups.find((g) => g.clusters.some((c) => normalizeClusterUrl(c) === wanted));
  return group?.databases ?? [];
}
