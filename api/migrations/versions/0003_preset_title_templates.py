"""A preset's title template replaces the Show in title of its inputs (ADR 0029).

Each preset is titled with its name, and its inputs lose ``showInTitle``.

Revision ID: 0003
Revises: 0002
Create Date: 2026-11-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("presets", sa.Column("title", sa.Text(), nullable=True))
    op.execute(
        """
        UPDATE presets SET
            title = name,
            inputs = COALESCE(
                (SELECT jsonb_agg(input - 'showInTitle' ORDER BY position)
                 FROM jsonb_array_elements(inputs) WITH ORDINALITY AS i(input, position)),
                '[]'::jsonb
            )
        """
    )
    op.alter_column("presets", "title", nullable=False)


def downgrade() -> None:
    # Inputs without showInTitle take its default: shown when read from the row.
    op.drop_column("presets", "title")
