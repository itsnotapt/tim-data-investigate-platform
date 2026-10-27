"""Run rows as json, not jsonb, so they keep their key order (ADR-0004).

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-27
"""

from collections.abc import Sequence

from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0008"
down_revision: str | None = "0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column(
        "run_rows",
        "data",
        type_=postgresql.JSON(none_as_null=True),
        existing_type=postgresql.JSONB(none_as_null=True),
        existing_nullable=False,
        postgresql_using="data::json",
    )


def downgrade() -> None:
    op.alter_column(
        "run_rows",
        "data",
        type_=postgresql.JSONB(none_as_null=True),
        existing_type=postgresql.JSON(none_as_null=True),
        existing_nullable=False,
        postgresql_using="data::jsonb",
    )
