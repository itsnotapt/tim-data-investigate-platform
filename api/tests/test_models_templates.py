import copy
import json
from pathlib import Path
from typing import Any, ClassVar

import pytest
from pydantic import TypeAdapter, ValidationError

from tim_api.templates.models import (
    QueryField,
    QueryParam,
    QueryTemplate,
    QueryTemplateCreate,
    QueryTemplateReplace,
    QueryType,
)

FIXTURES = Path(__file__).parent / "fixtures"
TEMPLATES: list[dict[str, Any]] = json.loads((FIXTURES / "templates.json").read_text())

AUDIT = {"createdBy", "updatedBy", "updated", "isDeleted"}


def errors_by_loc(exc: ValidationError) -> dict[str, str]:
    return {".".join(str(p) for p in e["loc"]): e["msg"] for e in exc.errors()}


def create_body(**over: Any) -> dict[str, Any]:
    body = {k: v for k, v in copy.deepcopy(TEMPLATES[0]).items() if k not in AUDIT}
    body.update(over)
    return body


@pytest.mark.parametrize("raw", TEMPLATES, ids=[t["name"] for t in TEMPLATES])
def test_round_trip(raw: dict[str, Any]) -> None:
    model = QueryTemplate.model_validate(raw)
    assert model.model_dump(mode="json", exclude_unset=True) == raw
    assert QueryTemplate.model_validate_json(model.model_dump_json()) == model


def test_list_round_trip_and_defaults() -> None:
    models = TypeAdapter(list[QueryTemplate]).validate_python(TEMPLATES)
    assert [m.query_type for m in models] == [QueryType.QUERY] * 2 + [
        QueryType.VIEW,
        QueryType.QUERY,
    ]
    dumped = models[2].model_dump(mode="json")
    assert dumped["params"] == {} and dumped["columns"] == {}
    assert dumped["columnId"] == "EventId"
    assert models[3].is_deleted is True


def test_columns_and_param_types_are_free_form() -> None:
    body = create_body(
        columns={"Anything": {"nested": [1, {"a": None}], "x": 1}},
        params={"P": {"type": "somethingNew", "default": {"a": 1}}},
        fields={"F": {"type": "futureType"}},
    )
    model = QueryTemplateCreate.model_validate(body)
    out = model.model_dump(mode="json")
    assert out["columns"] == body["columns"]
    assert out["params"]["P"]["type"] == "somethingNew"
    assert out["fields"]["F"]["type"] == "futureType"


def test_uuid_normalised_lowercase() -> None:
    model = QueryTemplateCreate.model_validate(
        create_body(uuid="11111111-AAAA-1111-1111-111111111111")
    )
    assert model.model_dump(mode="json")["uuid"] == "11111111-aaaa-1111-1111-111111111111"


def test_malformed_uuid_rejected() -> None:
    with pytest.raises(ValidationError) as exc:
        QueryTemplateCreate.model_validate(create_body(uuid="not-a-guid"))
    assert "uuid" in errors_by_loc(exc.value)


@pytest.mark.parametrize(
    "field",
    ["uuid", "name", "queryType", "menu", "summary", "path", "cluster", "database", "query"],
)
def test_required_fields(field: str) -> None:
    body = create_body()
    del body[field]
    with pytest.raises(ValidationError) as exc:
        QueryTemplateCreate.model_validate(body)
    assert list(errors_by_loc(exc.value)) == [field]


@pytest.mark.parametrize("field", ["name", "menu", "summary", "database", "query"])
@pytest.mark.parametrize("blank", ["", "   \n"])
def test_blank_strings_rejected(field: str, blank: str) -> None:
    with pytest.raises(ValidationError) as exc:
        QueryTemplateCreate.model_validate(create_body(**{field: blank}))
    assert list(errors_by_loc(exc.value)) == [field]


def test_path_must_not_be_null() -> None:
    with pytest.raises(ValidationError):
        QueryTemplateCreate.model_validate(create_body(path=None))


def test_query_type_enum() -> None:
    with pytest.raises(ValidationError) as exc:
        QueryTemplateCreate.model_validate(create_body(queryType="sql"))
    assert list(errors_by_loc(exc.value)) == ["queryType"]


@pytest.mark.parametrize("fields", [None, {}])
def test_query_template_requires_fields(fields: Any) -> None:
    body = create_body(fields=fields)
    if fields is None:
        del body["fields"]
    with pytest.raises(ValidationError) as exc:
        QueryTemplateCreate.model_validate(body)
    assert list(errors_by_loc(exc.value)) == ["fields"]
    assert "queryType is 'query'" in errors_by_loc(exc.value)["fields"]


def test_view_template_needs_no_fields() -> None:
    body = create_body(queryType="view")
    del body["fields"]
    model = QueryTemplateCreate.model_validate(body)
    assert model.fields is None


def test_array_param_requires_values() -> None:
    for params in ({"P": {"type": "array"}}, {"P": {"type": "array", "values": []}}):
        with pytest.raises(ValidationError) as exc:
            QueryTemplateCreate.model_validate(create_body(params=params))
        assert list(errors_by_loc(exc.value)) == ["params.P.values"]
    ok = QueryParam.model_validate({"type": "array", "values": ["a"]})
    assert ok.values == ["a"]
    assert QueryParam.model_validate({"type": "string"}).values is None


def test_multiple_field_requires_from() -> None:
    with pytest.raises(ValidationError) as exc:
        QueryTemplateCreate.model_validate(create_body(fields={"F": {"type": "multiple"}}))
    assert list(errors_by_loc(exc.value)) == ["fields.F.from_"]
    field = QueryField.model_validate({"type": "multiple", "from": "Other"})
    assert field.model_dump(mode="json", exclude_none=True) == {"type": "multiple", "from": "Other"}
    assert QueryField.model_validate({"type": "multiple", "from_": "Other"}).from_ == "Other"


def test_match_field_requires_valid_regex() -> None:
    with pytest.raises(ValidationError) as exc:
        QueryField.model_validate({"type": "match"})
    assert "required" in errors_by_loc(exc.value)["regex"]
    with pytest.raises(ValidationError) as exc:
        QueryField.model_validate({"type": "match", "regex": "(unclosed"})
    assert "regular expression" in errors_by_loc(exc.value)["regex"]
    assert QueryField.model_validate({"type": "match", "regex": r"^\d+$"}).regex == r"^\d+$"


def test_all_failing_rules_reported() -> None:
    body = create_body(
        fields={"A": {"type": "multiple"}, "B": {"type": "match"}},
        params={"P": {"type": "array"}},
        name="",
    )
    with pytest.raises(ValidationError) as exc:
        QueryTemplateCreate.model_validate(body)
    assert set(errors_by_loc(exc.value)) == {
        "name",
        "fields.A.from_",
        "fields.B.regex",
        "params.P.values",
    }


def test_param_and_field_type_required() -> None:
    with pytest.raises(ValidationError):
        QueryParam.model_validate({})
    with pytest.raises(ValidationError):
        QueryField.model_validate({"from": "x"})


class TestServerOwnedFields:
    SERVER: ClassVar[dict[str, Any]] = {
        "createdBy": "mallory",
        "updatedBy": "mallory",
        "updated": "2001-01-01T00:00:00Z",
        "unknownField": 1,
    }

    def test_create_ignores_audit_fields(self) -> None:
        model = QueryTemplateCreate.model_validate(create_body(**self.SERVER))
        dumped = model.model_dump(mode="json")
        assert not ({"createdBy", "updatedBy", "updated", "unknownField"} & dumped.keys())

    def test_replace_ignores_is_deleted_and_audit_fields(self) -> None:
        model = QueryTemplateReplace.model_validate(create_body(isDeleted=True, **self.SERVER))
        dumped = model.model_dump(mode="json")
        assert not ({"isDeleted", "createdBy", "updatedBy", "updated"} & dumped.keys())

    def test_create_rejects_deleted_template(self) -> None:
        with pytest.raises(ValidationError) as exc:
            QueryTemplateCreate.model_validate(create_body(isDeleted=True))
        assert list(errors_by_loc(exc.value)) == ["isDeleted"]

    def test_create_accepts_is_deleted_false(self) -> None:
        assert QueryTemplateCreate.model_validate(create_body(isDeleted=False)).is_deleted is False

    def test_stored_template_requires_audit_fields(self) -> None:
        with pytest.raises(ValidationError) as exc:
            QueryTemplate.model_validate(create_body())
        assert set(errors_by_loc(exc.value)) == {"updated", "createdBy", "updatedBy"}


def test_patch_result_revalidated_like_post() -> None:
    stored = copy.deepcopy(TEMPLATES[0])
    stored["fields"] = {}
    with pytest.raises(ValidationError):
        QueryTemplate.model_validate(stored)
    restored = copy.deepcopy(TEMPLATES[3])
    restored["isDeleted"] = False
    assert QueryTemplate.model_validate(restored).is_deleted is False
