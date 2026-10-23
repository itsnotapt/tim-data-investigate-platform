"""Presets and each analyst's hidden presets (ADR-0004).

Revision ID: 0004
Revises: 0003
Create Date: 2026-10-22
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(none_as_null=True)


def upgrade() -> None:
    op.create_table(
        "presets",
        sa.Column("preset_id", sa.Uuid(), primary_key=True),
        sa.Column("owner", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("menu_path", _jsonb(), nullable=False),
        sa.Column("visibility", sa.String(16), nullable=False),
        sa.Column("action", sa.Text(), nullable=False),
        sa.Column("params", _jsonb(), nullable=False),
        sa.Column("inputs", _jsonb(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_presets_created_id", "presets", ["created_at", "preset_id"])
    op.create_table(
        "preset_hidden",
        sa.Column(
            "preset_id",
            sa.Uuid(),
            sa.ForeignKey("presets.preset_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("analyst", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("preset_id", "analyst"),
    )


def downgrade() -> None:
    op.drop_table("preset_hidden")
    op.drop_table("presets")
