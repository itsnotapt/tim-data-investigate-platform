/** Same text as legacy `defaultNewQuery()` (frontend/src/helpers/displayComponent.js:26). */
export const DEFAULT_QUERY_EXAMPLE = `declare query_parameters(StartTime:datetime, EndTime:datetime);
DeviceProcessEvents
| where Timestamp between (StartTime .. EndTime)
| take 1
| extend EventTime=Timestamp, Cluster=current_cluster_endpoint(), EventId=strcat(DeviceId, ReportIndex)`;

/** Query text of a new ad-hoc tab (legacy `defaultNewQuery`). */
export const defaultNewQuery = (): string => DEFAULT_QUERY_EXAMPLE;
