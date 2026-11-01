# The demo dataset

The demo instance's data: the BOTSv3 security dataset, converted to one gzipped JSONL file per sourcetype. The files and their `SHA256SUMS` are on the GitHub release [`demo-data-v1`](https://github.com/itsnotapt/tim-data-investigate-platform/releases/tag/demo-data-v1). `sha256sum -c SHA256SUMS` checks a download.

## The data

Version 1 has 1,944,092 events across 107 sourcetypes. Each line of a file is one event, with these fields:

| Field | Value |
|---|---|
| `EventId` | A random GUID, unique to the event |
| `Timestamp` | The event's time in UTC, such as `2018-08-20T10:00:00Z` or `2018-08-20T09:04:06.119999Z` |
| `Host` | The host that logged the event |
| `Source` | The file or input the event came from |
| `SourceType` | The kind of log, such as `XmlWinEventLog:Microsoft-Windows-Sysmon/Operational` |
| `Raw` | The event's text, as it was logged |

## How the files were made

1. Downloaded the [archive](https://botsdataset.s3.amazonaws.com/botsv3/botsv3_data_set.tgz), sha256 `734b7af174347a1c0bda8bec4ed5d2e073c6075d98ff07cafac55c75b5153df1`. It holds Splunk index buckets.
2. Exported each bucket in `botsv3_data_set/var/lib/splunk/botsv3/db/` to a CSV with `splunk cmd exporttool <bucket> <bucket>.csv -csv`, in a running `splunk/splunk:10.6.1.1` container. The archive's files are readable only by their owner, so the container's `splunk` user needs them made readable first.
3. Converted each CSV row to an event, written to its sourcetype's file:
   - **`EventId`:** a new random GUID. The data has no id of its own, and 29,689 events are exact duplicates of another.
   - **`Timestamp`:** `_time`, with the `_subsecond` digits from `_meta` truncated to six. An event without them has none.
   - **`Host`, `Source` and `SourceType`:** without their `host::`, `source::` and `sourcetype::` prefixes.
   - **Bytes that aren't UTF-8:** kept as `\xNN` text, in any field.
   - **The file name:** the lowercased sourcetype, with characters other than `a-z`, `0-9`, `_`, `.` and `-` replaced by `_`, plus `.jsonl.gz`.
4. Checked the events per sourcetype against `| tstats count where index=botsv3 by sourcetype` in Splunk, and that no two events share an `EventId`.

The original data already cut some `Raw` values at 1,000,000 bytes, and they stay cut. Making the files again gives new GUIDs, so it would be a new release, `demo-data-v2`.

## Credit

BOTSv3 was written in 2018 by Ryan Kovar, David Herrald, James Brodsky, John Stoner, Jim Apger, David Veuve, Lily Lee and Matt Valites. Its authors dedicated it to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). The converted files are released under the same terms.
