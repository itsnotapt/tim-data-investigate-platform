"""Action-based TIM: runs, annotations, presets and column views, replacing query_templates and
query_runs (ADR-0004, ADR-0012, ADR-0020, ADR-0022, ADR-0023).

Revision ID: 0002
Revises: 0001
Create Date: 2026-10-28
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


def _json() -> postgresql.JSON:
    return postgresql.JSON(none_as_null=True)


def _ts() -> sa.DateTime:
    return sa.DateTime(timezone=True)


def upgrade() -> None:
    op.create_table(
        "runs",
        sa.Column("run_id", sa.Uuid(), primary_key=True),
        sa.Column("owner", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("action", _jsonb(), nullable=False),
        sa.Column("params", _jsonb(), nullable=False),
        sa.Column("details", _json(), nullable=False),
        sa.Column("columns", _jsonb()),
        sa.Column("row_count", sa.Integer()),
        sa.Column("error", sa.Text()),
        sa.Column("started_at", _ts(), nullable=False),
        sa.Column("finished_at", _ts()),
        sa.Column("expires_at", _ts(), nullable=False),
        sa.Column(
            "cancel_requested", sa.Boolean(), nullable=False, server_default=sa.text("false")
        ),
        sa.Column("heartbeat_at", _ts(), nullable=False),
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
        sa.Column("row_number", sa.Integer(), nullable=False),
        sa.Column("id", sa.Text()),
        sa.Column("data", _json(), nullable=False),
        sa.PrimaryKeyConstraint("run_id", "row_number"),
        prefixes=["UNLOGGED"],
    )

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
        sa.Column("saved_at", _ts(), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("version", sa.BigInteger(), nullable=False),
        sa.PrimaryKeyConstraint("id", "author"),
    )

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
        sa.Column("created_at", _ts(), nullable=False),
        sa.Column("updated_at", _ts(), nullable=False),
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

    op.create_table(
        "column_views",
        sa.Column("view_id", sa.Uuid(), primary_key=True),
        sa.Column("owner", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("visibility", sa.String(16), nullable=False),
        sa.Column("saved_from_action", sa.Text(), nullable=False),
        sa.Column("saved_from_preset_id", sa.Uuid(), nullable=True),
        sa.Column("state", _jsonb(), nullable=False),
        sa.Column("created_at", _ts(), nullable=False),
        sa.Column("updated_at", _ts(), nullable=False),
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

    op.drop_table("query_templates")
    op.drop_table("query_runs")


def downgrade() -> None:
    op.create_table(
        "query_templates",
        sa.Column("uuid", sa.Uuid(), primary_key=True),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_managed", sa.Boolean(), nullable=False),
        sa.Column("query_type", sa.String(16), nullable=False),
        sa.Column("menu", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("path", _jsonb(), nullable=False),
        sa.Column("cluster", sa.Text(), nullable=False),
        sa.Column("database", sa.Text(), nullable=False),
        sa.Column("column_id", sa.Text()),
        sa.Column("params", _jsonb()),
        sa.Column("fields", _jsonb()),
        sa.Column("columns", _jsonb()),
        sa.Column("query", sa.Text(), nullable=False),
        sa.Column("is_deleted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("updated", _ts(), nullable=False),
        sa.Column("created_by", sa.Text(), nullable=False),
        sa.Column("updated_by", sa.Text(), nullable=False),
    )
    op.create_index("ix_query_templates_updated_uuid", "query_templates", ["updated", "uuid"])
    op.create_table(
        "query_runs",
        sa.Column("query_run_id", sa.Uuid(), primary_key=True),
        sa.Column("requested_by", sa.Text(), nullable=False),
        sa.Column("status", sa.String(16), nullable=False),
        sa.Column("execute_date_time_utc", _ts(), nullable=False),
        sa.Column("expires_at", _ts(), nullable=False),
        sa.Column("kusto_query", _jsonb(), nullable=False),
        sa.Column("execution_metrics", _jsonb()),
        sa.Column("result_data", _jsonb()),
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

    op.drop_table("column_view_hidden")
    op.drop_table("column_views")
    op.drop_table("preset_hidden")
    op.drop_table("presets")
    op.drop_table("comments")
    op.drop_table("tags")
    op.drop_table("label_changes")
    op.drop_table("id_state")
    op.drop_table("annotation_clock")
    op.drop_table("run_rows")
    op.drop_table("runs")
