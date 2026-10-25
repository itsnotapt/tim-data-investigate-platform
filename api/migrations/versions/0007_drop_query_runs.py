"""Drop query_runs (ADR-0004).

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0007"
down_revision: str | None = "0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _json() -> postgresql.JSONB:
    return postgresql.JSONB(none_as_null=True)


def upgrade() -> None:
    op.drop_table("query_runs")


def downgrade() -> None:
    op.create_table(
        "query_runs",
        sa.Column("query_run_id", sa.Uuid(), primary_key=True),
        sa.Column("requested_by", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("execute_date_time_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("kusto_query", _json(), nullable=False),
        sa.Column("execution_metrics", _json()),
        sa.Column("result_data", _json()),
        sa.Column("main_error", sa.Text()),
    )
    op.create_index("ix_query_runs_requested_by", "query_runs", ["requested_by"])
    op.create_index("ix_query_runs_expires_at", "query_runs", ["expires_at"])
    op.create_index(
        "ix_query_runs_created_executed",
        "query_runs",
        ["execute_date_time_utc"],
        postgresql_where=sa.text("status = 'created'"),
    )
