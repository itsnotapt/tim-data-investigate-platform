"""Runs the storage contract suite against every implementation (memory and PostgreSQL).

The parametrised ``storage`` fixture lives in ``conftest.py``.
"""

from storage_contract import (
    AnnotationContract,
    HealthContract,
    QueryRunContract,
    RunContract,
    TemplateContract,
)


class TestTemplateStore(TemplateContract):
    pass


class TestQueryRunStore(QueryRunContract):
    pass


class TestRunStore(RunContract):
    pass


class TestStorageHealth(HealthContract):
    pass


class TestAnnotationStore(AnnotationContract):
    pass
