"""Annotations as they are stored and sent: the same shape everywhere (ADR-0020)."""

from __future__ import annotations

from collections.abc import Collection
from dataclasses import dataclass
from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from tim_api.models_common import ApiModel, UtcDatetime

MAX_ID_LENGTH = 512


class LabelState(ApiModel):
    """An id's label: its key, who set it and when."""

    key: str
    by: str
    at: UtcDatetime


class Comment(ApiModel):
    """An author's current comment on an id."""

    author: str
    at: UtcDatetime
    text: str


class Annotations(ApiModel):
    """An id's annotations, as of ``version``: the version of the change that last touched it.
    ``comments`` holds each author's current comment, oldest first."""

    id: str
    label: LabelState | None
    tags: list[str] = Field(default_factory=list)
    comments: list[Comment] = Field(default_factory=list)
    version: int


AnnotationId = Annotated[str, StringConstraints(min_length=1, max_length=MAX_ID_LENGTH)]


class AnnotationsChange(ApiModel):
    """``PATCH /api/annotations``: a change to every one of ``ids``.

    - Leaving ``label`` out keeps it; ``null`` clears it.
    - ``addTags`` and ``removeTags`` change the tags; ``setTags`` (Override) replaces them.
    - ``comment`` sets the caller's comment on each id, replacing theirs; ``null`` clears it;
      leaving it out keeps it (ADR-0023).
    """

    ids: list[AnnotationId] = Field(min_length=1)
    label: str | None = None
    add_tags: list[str] = Field(default_factory=list)
    remove_tags: list[str] = Field(default_factory=list)
    set_tags: list[str] | None = None
    comment: str | None = None


class ChangedAnnotations(ApiModel):
    """The ids the change changed, as they now are, and its version: the current one when it
    changed nothing."""

    changes: list[Annotations]
    version: int


class LabelEntry(ApiModel):
    """A label change in an id's history: the label it set, ``null`` when it cleared it."""

    kind: Literal["label"]
    label: str | None
    by: str
    at: UtcDatetime


class CommentEntry(ApiModel):
    """An author's comment in an id's history, as they last saved it."""

    kind: Literal["comment"]
    author: str
    at: UtcDatetime
    text: str


HistoryEntry = Annotated[LabelEntry | CommentEntry, Field(discriminator="kind")]


class AnnotationHistory(ApiModel):
    """``GET /api/annotations/history``: an id's label changes and each author's comment,
    newest first."""

    entries: list[HistoryEntry]


class TagSuggestions(ApiModel):
    """Tags that start with a prefix: the analyst's own, most recently added first, then the
    others, most used first."""

    recent: list[str]
    most_used: list[str]


class AnnotationChangesPage(ApiModel):
    """A page of the change feed. ``next`` is the ``since`` of the next page."""

    changes: list[Annotations]
    next: int
    has_more: bool


@dataclass(frozen=True)
class AnnotationEdit:
    """What one change does to every id it names.

    - With ``set_label``, set the label to ``label``, or clear it when that is ``None``.
    - Add ``add_tags``, then remove ``remove_tags``; or, when ``set_tags`` isn't ``None``, make
      the tags exactly ``set_tags``.
    - With ``set_comment``, set the author's comment to ``comment``, or clear it when that is
      ``None`` (ADR-0023).
    """

    set_label: bool = False
    label: str | None = None
    add_tags: frozenset[str] = frozenset()
    remove_tags: frozenset[str] = frozenset()
    set_tags: frozenset[str] | None = None
    set_comment: bool = False
    comment: str | None = None

    def tags_after(self, tags: Collection[str]) -> set[str]:
        """The tags an id with ``tags`` has after this edit."""
        if self.set_tags is not None:
            return set(self.set_tags)
        return (set(tags) | self.add_tags) - self.remove_tags


@dataclass(frozen=True)
class AnnotationsChanged:
    """The ids a change changed, as they now are, and the version: the change's own, or the
    current one when nothing changed."""

    changes: list[Annotations]
    version: int


@dataclass(frozen=True)
class AnnotationsOf:
    """The annotations of those ids that have any, and the version they are current as of."""

    annotations: dict[str, Annotations]
    version: int


@dataclass(frozen=True)
class AnnotationChanges:
    """A page of the change feed: the ids changed after ``since``, as they now are, in version
    order. ``has_more`` when later changes are left for the next page."""

    changes: list[Annotations]
    has_more: bool
