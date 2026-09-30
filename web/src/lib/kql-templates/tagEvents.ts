import { escapeKqlVerbatim } from './escape';

/**
 * The `{{> getTagEvents}}` partial: KQL text ported verbatim from the legacy
 * `frontend/src/helpers/kustoQueries.js:4-39` (whitespace included; a test compares the rendered
 * text with a fixture generated from the legacy source). Only the tag cluster and database are
 * interpolated, exactly as legacy did at module load; here they are escaped as KQL literals
 * (they come from runtime config, not user input, so normal values render unchanged).
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
