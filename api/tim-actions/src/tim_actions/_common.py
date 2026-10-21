"""Validation building blocks shared by the declarations."""

from typing import Annotated

from pydantic import AfterValidator, ConfigDict

# Declarations allow no unknown fields, and the field types say where a value may be coerced
# (a list for a tuple, never a string for a bool).
STRICT = ConfigDict(extra="forbid")


def _non_blank(value: str) -> str:
    if not value.strip():
        raise ValueError("must not be blank")
    return value


NonBlankStr = Annotated[str, AfterValidator(_non_blank)]
