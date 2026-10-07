export const DEFAULT_QUERY_EXAMPLE = `declare query_parameters(StartTime:datetime, EndTime:datetime);
DeviceProcessEvents
| where Timestamp between (StartTime .. EndTime)
| take 1
| extend EventTime=Timestamp, Cluster=current_cluster_endpoint(), EventId=strcat(DeviceId, ReportIndex)`;

/** Query text of a new ad-hoc tab. */
export const defaultNewQuery = (): string => DEFAULT_QUERY_EXAMPLE;
