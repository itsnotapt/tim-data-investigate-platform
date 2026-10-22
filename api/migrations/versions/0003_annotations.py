"""Annotations of ids and the change feed's version clock (ADR-0004, ADR-0020).

Revision ID: 0003
Revises: 0002
Create Date: 2026-10-21
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "annotation_clock",
        sa.Column("one", sa.Boolean(), primary_key=True, server_default=sa.true()),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.CheckConstraint("one", name="ck_annotation_clock_one_row"),
    )
    op.execute("INSERT INTO annotation_clock (one, version) VALUES (true, 0)")
    op.create_table(
        "id_state",
        sa.Column("id", sa.Text(), primary_key=True),
        sa.Column("label", sa.Text()),
        sa.Column("labelled_by", sa.Text()),
        sa.Column("labelled_at", _ts()),
        sa.Column("version", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_id_state_version", "id_state", ["version"])
    op.create_table(
        "label_changes",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("label", sa.Text()),
        sa.Column("changed_by", sa.Text(), nullable=False),
        sa.Column("changed_at", _ts(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id", "version"),
    )
    op.create_table(
        "tags",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("tag", sa.Text(), nullable=False),
        sa.Column("added_by", sa.Text(), nullable=False),
        sa.Column("added_at", _ts(), nullable=False),
        sa.PrimaryKeyConstraint("id", "tag"),
    )
    op.create_table(
        "comments",
        sa.Column("id", sa.Text(), nullable=False),
        sa.Column("author", sa.Text(), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
    )
    op.create_index("ix_comments_id", "comments", ["id", "version"])


def downgrade() -> None:
    op.drop_table("comments")
    op.drop_table("tags")
    op.drop_table("label_changes")
    op.drop_table("id_state")
    op.drop_table("annotation_clock")
