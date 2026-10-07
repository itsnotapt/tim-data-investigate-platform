import { escapeKqlVerbatim } from './escape';

/**
 * The `{{> getTagEvents}}` partial (whitespace is significant; a test compares the rendered text
 * with a fixture). Only the tag cluster and database are interpolated, escaped as KQL literals.
 */
export function buildTagEventsPartial(tagCluster: string, tagDatabase: string): string {
  const cluster = escapeKqlVerbatim(tagCluster);
  const database = escapeKqlVerbatim(tagDatabase);
  return `
let getTagEvents=(T:(EventId:string)) {
  let EventIds=materialize(T | distinct EventId);
  let Events=EventIds
  | join kind=leftouter (
    cluster('${cluster}').database('${database}').SavedEvent
    | where EventId in (EventIds)
    | summarize arg_max(DateTimeUtc, *) by EventId
    | project EventId, IsSaved=true
  ) on EventId
  | join kind=leftouter (
    cluster('${cluster}').database('${database}').EventTag
    | where EventId in (EventIds)
    | summarize arg_max(DateTimeUtc, IsDeleted) by EventId, Tag
    | where not(IsDeleted)
    | summarize Tags=make_set(Tag) by EventId
    | project EventId, Tags
  ) on EventId
  | join kind=leftouter (
    cluster('${cluster}').database('${database}').EventComment
    | where EventId in (EventIds)
    | sort by DateTimeUtc desc
    | summarize arg_max(DateTimeUtc, Determination, IsDeleted, Comment),
      Comments=make_list(pack("CreatedBy", CreatedBy, "Comment", Comment, "Determination", Determination, "DateTimeUtc", DateTimeUtc))
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
`;
}
