"""What a real Snowflake account answered, as recorded by ``record_snowflake.py``: for each
statement, the connector's description and rows, or the error it raised. Values the connector
gives that JSON can't hold (``Decimal``, ``datetime``, ``bytes``, ...) are stored tagged, such as
``{"$decimal": "1.50"}``."""

import base64
import json
import math
from collections.abc import Sequence
from datetime import date, datetime, time
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any

from snowflake.connector import errors as sf_errors

RECORDING = Path(__file__).parent / "fixtures" / "snowflake.json"

Answer = tuple[list[Any], list[tuple[Any, ...]]] | Exception

_DECODERS: dict[str, Any] = {
    "$decimal": Decimal,
    "$float": float,
    "$datetime": datetime.fromisoformat,
    "$date": date.fromisoformat,
    "$time": time.fromisoformat,
    "$bytes": base64.b64decode,
}


def encode(value: Any) -> Any:
    """A connector value as JSON."""
    if value is None or isinstance(value, bool | int | str):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else {"$float": str(value)}
    if isinstance(value, Decimal):
        return {"$decimal": str(value)}
    # ``datetime`` before ``date``, its base class.
    for tag, kind in (("$datetime", datetime), ("$date", date), ("$time", time)):
        if isinstance(value, kind):
            return {tag: value.isoformat()}
    if isinstance(value, bytes | bytearray):
        return {"$bytes": base64.b64encode(value).decode()}
    if isinstance(value, list | tuple):
        return [encode(v) for v in value]
    if isinstance(value, dict):
        return {k: encode(v) for k, v in value.items()}
    raise TypeError(f"can't record a {type(value).__name__}: {value!r}")


def decode(value: Any) -> Any:
    """A value stored by ``encode``, as the connector gave it."""
    if isinstance(value, list):
        return [decode(v) for v in value]
    if isinstance(value, dict):
        [(tag, text)] = value.items() if len(value) == 1 else [(None, None)]
        if tag in _DECODERS:
            return _DECODERS[tag](text)
        return {k: decode(v) for k, v in value.items()}
    return value


def encode_error(exc: sf_errors.Error) -> dict[str, Any]:
    return {
        "class": type(exc).__name__,
        "msg": exc.raw_msg,
        "errno": exc.errno,
        "sqlstate": exc.sqlstate,
    }


def decode_error(error: dict[str, Any]) -> sf_errors.Error:
    error_class: type[sf_errors.Error] = getattr(sf_errors, error["class"])
    return error_class(error["msg"], errno=error["errno"], sqlstate=error["sqlstate"])


def encode_description(description: Sequence[Any]) -> list[dict[str, Any]]:
    return [
        {"name": d.name, "type_code": d.type_code, "precision": d.precision, "scale": d.scale}
        for d in description
    ]


def load() -> dict[str, Answer]:
    """The recorded answer to each statement, by its text."""
    recording = json.loads(RECORDING.read_text())
    answers: dict[str, Answer] = {}
    for statement in recording["statements"]:
        if "error" in statement:
            answers[statement["sql"]] = decode_error(statement["error"])
        else:
            description = [SimpleNamespace(**d) for d in statement["description"]]
            rows = [tuple(decode(v) for v in row) for row in statement["rows"]]
            answers[statement["sql"]] = (description, rows)
    return answers
