"""Runs of actions and their rows: runs and the UNLOGGED run_rows (ADR-0004, ADR-0012).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-20
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _jsonb() -> postgresql.JSONB:
    return postgresql.JSONB(none_as_null=True)


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("run_id", sa.Uuid(), primary_key=True),
        sa.Column("owner", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("action", _jsonb(), nullable=False),
        sa.Column("params", _jsonb(), nullable=False),
        sa.Column("details", postgresql.JSON(none_as_null=True), nullable=False),
        sa.Column("columns", _jsonb()),
        sa.Column("row_count", sa.Integer()),
        sa.Column("error", sa.Text()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "cancel_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
    )
    op.create_index("ix_runs_expires_at", "runs", ["expires_at"])
    op.create_index(
        "ix_runs_running_started",
        "runs",
        ["started_at"],
        postgresql_where=sa.text("status = 'running'"),
    )
    op.create_table(
        "run_rows",
        sa.Column(
            "run_id",
            sa.Uuid(),
            sa.ForeignKey("runs.run_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("ordinal", sa.Integer(), nullable=False),
        sa.Column("id", sa.Text()),
        sa.Column("data", _jsonb(), nullable=False),
        sa.PrimaryKeyConstraint("run_id", "ordinal"),
        prefixes=["UNLOGGED"],
    )


def downgrade() -> None:
    op.drop_table("run_rows")
    op.drop_table("runs")
