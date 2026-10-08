"""Write the OpenAPI spec to disk: ``uv run python -m tim_api.openapi_export [--out PATH]``.

Needs no environment and no database: the app is built but never started (no lifespan).
Output is deterministic (sorted keys, trailing newline).
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from tim_api.main import create_app

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_OUT = REPO_ROOT / "web" / "src" / "lib" / "api" / "openapi.json"


def generate_spec() -> dict[str, Any]:
    spec: dict[str, Any] = create_app().openapi()
    return spec


def render_spec() -> str:
    return json.dumps(generate_spec(), indent=2, sort_keys=True, ensure_ascii=False) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Export the TIM API OpenAPI spec.")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="output path")
    args = parser.parse_args(argv)
    out: Path = args.out
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_spec(), encoding="utf-8", newline="\n")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
