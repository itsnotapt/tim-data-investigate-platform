"""Drop query_templates (ADR-0004).

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0006"
down_revision: str | None = "0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _json() -> postgresql.JSONB:
    return postgresql.JSONB(none_as_null=True)


def upgrade() -> None:
    op.drop_table("query_templates")


def downgrade() -> None:
    op.create_table(
        "query_templates",
        sa.Column("uuid", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_managed", sa.Boolean(), nullable=False),
        sa.Column("query_type", sa.String(16), nullable=False),
        sa.Column("menu", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("path", _json(), nullable=False),
        sa.Column("cluster", sa.Text(), nullable=False),
        sa.Column("database", sa.Text(), nullable=False),
        sa.Column("column_id", sa.Text()),
        sa.Column("params", _json()),
        sa.Column("fields", _json()),
        sa.Column("columns", _json()),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False),
    )
    op.create_index("ix_query_templates_updated_uuid", "query_templates", ["updated", "uuid"])
