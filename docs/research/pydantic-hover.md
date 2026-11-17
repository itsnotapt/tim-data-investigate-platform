# How can pydantic models read well in `help()`, hover and JSON Schema?

Question: [How can pydantic models read well in help(), hover and JSON Schema?](https://github.com/itsnotapt/tim-data-investigate-platform/issues/320) (map: [Wayfinder: action authoring that's easy to start and fully specified](https://github.com/itsnotapt/tim-data-investigate-platform/issues/318)). The motivating findings are §9 "Docstrings and hover" of [the action-authoring trials](https://github.com/itsnotapt/tim-data-investigate-platform/issues/315).

Versions checked on 2026-11-16:

- **Runtime:** pydantic 2.13.5 and CPython 3.12.14, from `api/uv.lock`.
- **Hover:** pyright 1.1.414, the engine Pylance uses.
- **YAML hover:** yaml-language-server `main` at `bf8ebb5`.
- **Comparable libraries:** FastAPI 0.163.1, Typer 0.29.1, Prefect 3.9.3 and `apache-airflow-providers-snowflake` 6.21.0, read from their published wheels.

Sources:

- [P1] pydantic docs, `ConfigDict.use_attribute_docstrings`, `field_title_generator`, `json_schema_extra`: https://pydantic.dev/docs/validation/latest/api/pydantic/config/
- [P2] pydantic docs, JSON Schema: https://pydantic.dev/docs/validation/latest/concepts/json_schema/
- [P3] pydantic source: `pydantic/_internal/_docs_extraction.py` (attribute docstrings), `pydantic/_internal/_fields.py:422` (`_update_fields_from_docstrings`), `pydantic/json_schema.py` (`_update_class_schema`, `field_title_should_be_set`, `get_title_from_name`), `pydantic/_internal/_model_construction.py:82` (`@dataclass_transform` on `ModelMetaclass`)
- [Y1] CPython `Lib/pydoc.py`: `visiblename`, `TextDoc.docclass` (3.12.14 lines 290–312 and 1371–1520; unchanged on `main`)
- [Y2] CPython `Lib/typing.py`: `_no_init_or_replace_init`, the `__init__` that `Protocol` gives its classes
- [R1] pyright `packages/pyright-internal/src/languageService/tooltipUtils.ts` (`getConstructorDocInfo`) and `src/analyzer/typeDocStringUtils.ts` (`resolveConstructorDocInfo`, `getVariableDocString`), tag 1.1.414
- [R2] pyright `src/analyzer/parseTreeUtils.ts` (`getVariableDocStringNode`: PEP 258 attribute docstrings, including after a bare annotation and after a `type` statement), tag 1.1.414
- [T1] Typing spec, Dataclasses (`dataclass_transform`): https://github.com/python/typing/blob/main/docs/spec/dataclasses.rst
- [L1] yaml-language-server `src/languageservice/services/yamlHover.ts` at `bf8ebb5`
- [F1] FastAPI `fastapi/param_functions.py`; PEP 727 (Status: Withdrawn): https://peps.python.org/pep-0727/
- [F2] Typer `typer/main.py` (`inspect.getdoc` of the callback), `typer/params.py`
- [F3] Prefect `prefect/blocks/core.py` (`schema_extra`, `Block.get_description`), `prefect/settings/models/api.py`
- [F4] Airflow Snowflake provider `hooks/snowflake.py` (`:param` docstrings, `get_connection_form_widgets`), `get_provider_info.py` (`conn-fields`)
- [M] Measurements: scripts run with `uv run` in `api/`, and a minimal LSP client driving `pyright-langserver --stdio` for hover. The results are quoted inline.

## Short answer

Each channel reads a different thing:

| Channel | Class docstring | Attribute docstring | `Field(description=)` | `json_schema_extra` | Signature |
|---|---|---|---|---|---|
| `help()` | yes | no | no | no | yes, with the `Annotated[...]` metadata spelled out |
| pyright/Pylance hover | yes on the class name; **no** on a constructor call | yes | **no** | no | synthesised from the fields, aliases kept by name |
| JSON Schema, yaml-language-server hover | model `description` | yes, with `use_attribute_docstrings=True` | yes, wins over the docstring | merged as given | n/a |

**Recommendation:**

- **One source per field:** write attribute docstrings and turn on `use_attribute_docstrings=True` in the shared configs (`STRICT`, `DocumentBase`, `ActionBase`, `Connection`). They reach pyright hover and the JSON Schema. `Field(description=)` reaches only the schema.
- **Aliases:** give the public aliases (`ParamKind`, `ColumnType`, `Pivot`, `DetailValue`, `TokenFor`) docstrings. pyright shows them on hover.
- **Schema output:** drop the auto-generated property titles in `tim-api schema`. yaml-language-server renders them as a `#### Find Pivot Rows` heading that says nothing.
- **`help()`:** treat it as the weakest channel. It never shows field docs. The ~400 inherited `BaseModel` lines can be cut with a metaclass `__dir__`, but only if type checkers never see that metaclass (§3). Point authors and agents at hover, `tim-api schema actions` and `docs/actions.md`.
- **`RunContext`:** its `(*args, **kwargs)` comes from `typing.Protocol`, not pydantic, and only `help()` shows it. pyright shows `class RunContext()`. Its docstring should say that TIM builds it and that tests get one from `tim_actions.testing`.

## 1. Where each mechanism reaches

**Attribute docstrings with `use_attribute_docstrings=True` reach the JSON Schema** [P1][P3][M]:

- pydantic parses the class source with `ast` and takes a bare string right after an annotated assignment as that field's `description` [P3].
- This works for `BaseModel`s and pydantic dataclasses [M].
- Subclasses inherit the config and the descriptions. A subclass defined in another package gets its own docstrings without setting the config again [M].
- Models made with `create_model(__base__=...)`, as `action_files_schema` does, keep the base's descriptions [M].
- `Field(description=...)` wins over the attribute docstring [P1][M].
- The docs warn that it "requires the source code of the class to be available at runtime (and so won't work in the interactive interpreter shell)" [P1]. A class built with `exec` got `description=None` and no error [M]. A provider shipped as `.pyc` only would lose its descriptions silently.

**The class docstring becomes the model's `description`** [P2][P3]. pydantic runs it through `inspect.cleandoc` in `_update_class_schema` [P3]. The `__doc__=` that `action_files_schema` passes to `create_model` takes the same path.

**`Field(description=)` reaches only the schema.** pyright's `dataclass_transform` support follows the spec's field-specifier parameters: `init`, `default`, `default_factory`, `factory`, `kw_only`, `alias` and `converter`, none of them a description [T1]. Hover on `Doc(beta=...)` with `beta: int = Field(description=...)` showed the type and no text [M].

**`json_schema_extra` is merged into the property's schema verbatim** [P1][P2]. That is the way to add keywords pydantic doesn't generate, for yaml-language-server [L1]:

- `markdownDescription`
- `enumDescriptions` or `markdownEnumDescriptions`, one per `Literal` value
- `examples`

**pyright hover reads attribute docstrings, not `FieldInfo`** [R1][R2][M]:

- It follows PEP 258 and extends it to a bare annotation (`x: int` then a string), which is how pydantic fields are written [R2].
- Hover on a keyword argument of a constructor call (`UsesKind(kind="a")`) and on an attribute access (`d.alpha`) both showed the field's docstring [M].
- A `type Kind = Literal[...]` statement followed by a string shows that string on hover of `Kind` [R2][M]. A module-level `X = ...` alias with a docstring works the same way [R2]. Bare aliases such as `ParamKind` show no text today [M].

**What the TIM schema carries now** [M]:

- **Action files:** 2 of 48 properties have a `description`, both generated `*_file` sidecar keys.
- **Connections file:** 0 of 15 properties have one.
- **Titles:** every property has a pydantic-generated `title` from `name.title().replace('_', ' ')` [P3]: "Kql", "Find Pivot Rows", "Id".

## 2. yaml-language-server hover

`YAMLHover` builds the hover text from the matching schemas, in this order [L1]:

1. `#### ` + `title` (or `closestTitle`).
2. `markdownDescription`, else `description` converted to Markdown.
3. "Allowed Values:", one bullet per `enum` value, each with its `markdownEnumDescriptions` or `enumDescriptions` entry if there is one.
4. "Example:" with each `examples` entry as YAML.

The consequences:

- **Titles:** a field with only the generated title hovers as a heading repeating the key. The trials' complaint that the schema "exposes `Param.title`" is this `title` keyword [M].
- **Dropping titles:** a `GenerateJsonSchema` subclass whose `field_title_should_be_set` returns `False`, passed as `schema_generator=` to `TypeAdapter.json_schema()`, leaves the property titles out and keeps the model titles [P2][P3][M].
- **Enum values:** `Literal` fields hover as a list of allowed values with no descriptions. Per-value text needs `enumDescriptions` through `json_schema_extra` [L1][P2].
- **`$ref` fields:** a field docstring on a `$ref` field (a `type` alias or a nested model) sits next to the `$ref` as a sibling `description` [M]. Draft 2020-12, the dialect TIM's schemas declare, allows that sibling.

## 3. `help()`

**Why it is 300–600 lines.** `pydoc.TextDoc.docclass` lists every attribute that `inspect.classify_class_attrs` finds through `dir(cls)`, grouped by defining class along the MRO. It skips only `builtins.object` [Y1]. `visiblename` shows every dunder, so `__pydantic_core_schema__` and friends appear too [Y1]. CPython `main` has the same logic [Y1]. There is no per-class opt-out.

Measured `help()` lengths [M]:

| Class | Lines | Of which from `BaseModel` |
|---|---|---|
| `KqlQueryFile` | 481 | ~396 |
| `Action` | 551 | |
| `RunKql` | 568 | |
| `Param` (pydantic dataclass) | 94 | none |
| `Column` (pydantic dataclass) | 90 | none |
| `RunContext` (`Protocol`) | 78 | none |

**Fields never appear.** pydantic removes field defaults from the class namespace, so pydoc has nothing to list. A model's `help()` is its signature plus the class docstring [M]. Attribute docstrings are invisible to `help()` with or without the config [M].

**The signature is noisy.** pydantic sets `__signature__` from the evaluated annotations, so `Annotated[str, StringConstraints(strip_whitespace=None, ..., pattern='^[a-z0-9_.-]+$', ascii_only=None)]` is printed in full [M]. PEP 695 aliases (`type ActionKey = Annotated[...]`) print by name: `(*, key: ActionKey, name: NonBlank) -> None` [M]. The schema changes with them: each alias becomes a `$defs` entry, and the field loses its generated title [M].

**Trimming with a metaclass `__dir__` works at runtime** [Y1][M]:

```python
if TYPE_CHECKING:
    _Meta = type(BaseModel)
else:
    class _Meta(type(BaseModel)):
        def __dir__(cls) -> list[str]:
            return [n for n in super().__dir__() if n not in _BASEMODEL_NAMES]

class DocumentBase(BaseModel, metaclass=_Meta): ...
```

- **Effect:** `help()` of a subclass dropped from 481 to 46 lines [M].
- **Still works:** validation, `model_dump`, `model_json_schema` and instance `dir()` were unchanged [M].
- **`type(BaseModel)`:** it is pydantic's `ModelMetaclass` [M], so no private import is needed.
- **Class `dir()` side effects:** `dir(cls)` no longer lists `model_validate` and the other `BaseModel` names. That affects REPL tab completion on the class and `inspect.getmembers`. pydantic v2 itself does not call `dir()` on models [P3].
- **The type checker must not see it.** `dataclass_transform` covers a class that "uses the decorated class as a metaclass", not a subclass of that metaclass [T1]. With the metaclass visible to pyright, hover on the constructor fell to `class QuietLeaf(**data: Any)` and keyword arguments lost their docstrings. Behind `if TYPE_CHECKING:` both came back [M].
- **Leftover noise:** the remaining ~20 lines are `__pydantic_*__` dunders, which the same filter could also drop.

**Alternatives:**

- Prefect parses Google-style docstrings to build schema descriptions [F3].
- Sphinx and autodoc-pydantic hide the inherited members with `:inherited-members: BaseModel`. That only helps rendered docs.
- `inspect.getdoc(X)`, which the trial agents wrote helpers for, gives the class docstring alone.

## 4. pyright/Pylance hover and constructor signatures

**Signatures come from `dataclass_transform`** [P3][T1][M]:

- `ModelMetaclass` carries `@dataclass_transform(kw_only_default=True, field_specifiers=...)` [P3].
- pyright synthesises `__init__` from the fields: `class KqlQueryFile(*, type: str, key: ActionKey, name: NonBlankStr, ..., kql: NonBlankStr)` [M].
- `Annotated` metadata is dropped and aliases are kept by name, old-style and PEP 695 alike [M]. Hover is already readable where `help()` is not.

**A constructor call shows pydantic's `__init__` docstring, not the class's** [R1][M]:

- `getConstructorDocInfo` takes the first `__init__`/`__new__` docstring found along the MRO and falls back to the class docstring only when there is none [R1].
- `BaseModel.__init__` has one, so hover on `KqlQueryFile(` and `Doc(` shows "Create a new model by parsing and validating input data from keyword arguments." [M]
- Hover on the class name (import, annotation, `Action`, `RunKql`) shows the class docstring [M].
- Defining `__init__` with a docstring replaces the synthesised signature with that `__init__`'s own, e.g. `(**data: object)` [M]. That trade is worse.
- pydantic dataclasses (`Param`, `Column`) have no inherited `__init__` docstring, so their constructor hover shows the class docstring [M].

**`RunContext`'s `(*args, **kwargs)` comes from `Protocol`** [Y2][M]:

- `typing.Protocol` sets `__init__` to `_no_init_or_replace_init(self, *args, **kwargs)`, which `inspect.signature` reports [Y2][M].
- pyright shows `class RunContext()` and its docstring [M].
- Members show their own docstrings (`ctx.hook`, `ctx.deadline`). `analyst` has none, so it hovers as a bare `(property) analyst: Analyst` [M].
- Authors never construct a `RunContext`. TIM passes one, and `tim_actions.testing` builds one for tests (`_Context` in `testing/runs.py`). The fix is a docstring that says so and documents `analyst`, not a signature trick.

**PyCharm** was not measured. It has its own pydantic support and does not use pyright.

## 5. Comparable libraries

| Library | Field/param docs | Where they show |
|---|---|---|
| FastAPI | `Annotated[..., Doc("...")]` from the `annotated-doc` package on every parameter of its own API (222 in `param_functions.py`) [F1]. PEP 727, which proposed `Doc`, is withdrawn: "mostly negative ... concerns raised about verbosity and readability" [F1]. User models use `Field(description=)` for OpenAPI. | Its mkdocs reference; not pyright hover |
| Typer | `help=` on `Option`/`Argument`; the command's text is `inspect.getdoc(callback)` [F2] | `--help` output |
| Prefect | `Field(description=...)` on settings and blocks [F3]. Blocks' schema `description` is the first text section of the Google-style class docstring, parsed with griffe, so `Args:` and examples stay out [F3]. | Prefect UI, schema |
| Airflow providers | Sphinx `:param` docstrings on hooks; connection fields declared as data (`conn-fields` with label and JSON Schema in `get_provider_info.py`, `get_connection_form_widgets`) [F4] | Sphinx docs, Airflow UI |

None of them makes `help()` on a pydantic model short. Each gives a schema or UI its own description source and relies on rendered docs for the API.

## Open points for "Hover and docstrings"

- Whether to adopt the metaclass trim (§3), or leave `help()` alone and point authors at hover, `tim-api schema actions` and `docs/actions.md`.
- Whether `type` aliases for `ActionKey`, `NonBlankStr` and `ConnectionName` are worth the `$defs` change in the schema, for shorter `help()` signatures.
- Whether TIM's `Literal`s (`ParamKind`, `ColumnType`, `Pivot`) get `enumDescriptions` in the schema.
