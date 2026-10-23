"""Column views and each analyst's hidden column views (ADR-0004, ADR-0022).

Revision ID: 0005
Revises: 0004
Create Date: 2026-10-23
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005"
down_revision: str | None = "0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "column_views",
        sa.Column("view_id", sa.Uuid(), primary_key=True),
        sa.Column("owner", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(16), nullable=False),
        sa.Column("saved_from_action", sa.Text(), nullable=False),
        sa.Column("saved_from_preset_id", sa.Uuid(), nullable=True),
        sa.Column("state", postgresql.JSONB(none_as_null=True), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_column_views_created_id", "column_views", ["created_at", "view_id"])
    op.create_table(
        "column_view_hidden",
        sa.Column(
            "view_id",
            sa.Uuid(),
            sa.ForeignKey("column_views.view_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("analyst", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("view_id", "analyst"),
    )


def downgrade() -> None:
    op.drop_table("column_view_hidden")
    op.drop_table("column_views")
