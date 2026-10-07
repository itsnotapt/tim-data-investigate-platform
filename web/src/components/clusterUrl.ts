/**
 * Cluster URL normalisation for the ad-hoc query form. Single implementation lives in
 * `lib/api` (`formatCluster`): trims, strips trailing slashes and prepends `https://` when no
 * scheme was typed; never appends `.kusto.windows.net`.
 */
export { formatCluster as normalizeClusterUrl } from '../lib/api/queryRuns';
