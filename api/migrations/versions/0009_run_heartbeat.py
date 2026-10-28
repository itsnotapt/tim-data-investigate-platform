"""Each run's heartbeat, which the sweep checks to find runs whose process is gone (ADR-0012).

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-27
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0009"
down_revision: str | None = "0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("runs", sa.Column("heartbeat_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE runs SET heartbeat_at = started_at")
    op.alter_column("runs", "heartbeat_at", nullable=False)


def downgrade() -> None:
    op.drop_column("runs", "heartbeat_at")
