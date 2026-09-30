/**
 * Sample KQL shown by QueryHelperDialog (legacy `QueryHelperDialog.vue`). Corrections vs legacy
 * (BUG-41): the function is invoked as `getTagEvents()` (legacy defined `getTagEvents` but invoked
 * `GetTagEvents`, which KQL treats as a different name), and the stray `}` after the default
 * example is gone.
 */

export const TIME_RANGE_SAMPLE = `declare query_parameters(StartTime:datetime, EndTime:datetime);
...
| where Timestamp between (StartTime .. EndTime)`;

export { DEFAULT_QUERY_EXAMPLE } from './defaultQuery';

export function buildTagEventsSample(tagCluster: string, tagDatabase: string): string {
  return `alias database Tags = cluster("${tagCluster}").database("${tagDatabase}");
let getTagEvents=(T:(EventId:string)) {
  let EventIds=materialize(T | distinct EventId);
  let Events=EventIds
  | join kind=leftouter (
    database("Tags").SavedEvent
    | where EventId in (EventIds)
    | summarize arg_max(DateTimeUtc, *) by EventId
    | project EventId, IsSaved=true
  ) on EventId
  | join kind=leftouter (
    database("Tags").EventTag
    | where EventId in (EventIds)
    | summarize arg_max(DateTimeUtc, IsDeleted) by EventId, Tag
    | where not(IsDeleted)
    | summarize Tags=make_set(Tag) by EventId
    | project EventId, Tags
  ) on EventId
  | join kind=leftouter (
    database("Tags").EventComment
    | where EventId in (EventIds)
    | sort by DateTimeUtc desc
    | summarize arg_max(DateTimeUtc, Determination, IsDeleted, Comment),
      Comments=make_list(pack(
            "CreatedBy", CreatedBy,
            "Comment", Comment,
            "Determination", Determination,
            "DateTimeUtc", DateTimeUtc))
      by EventId
    | where not(IsDeleted)
    | project EventId, Determination, Comment, Comments
  ) on EventId
  | project-away EventId1, EventId2, EventId3
  | extend TagEvent=pack_all()
  | project EventId, TagEvent;
  T
  | join kind=inner Events on EventId
  | project-away EventId1
};
CreateFileEvents
| take 1
| invoke getTagEvents()`;
}
