"""Annotations as they are stored and sent: the same shape everywhere (ADR-0020)."""

from __future__ import annotations

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
    author: str
    at: UtcDatetime
    text: str


class Annotations(ApiModel):
    """An id's annotations, as of ``version``: the version of the change that last touched it."""

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
    - ``comment`` is appended to each id's comments.
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
    """A comment in an id's history."""

    kind: Literal["comment"]
    author: str
    at: UtcDatetime
    text: str


HistoryEntry = Annotated[LabelEntry | CommentEntry, Field(discriminator="kind")]


class AnnotationHistory(ApiModel):
    """``GET /api/annotations/history``: an id's label changes and comments, newest first."""

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
