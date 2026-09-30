"""Runs the storage contract suite against every implementation (memory and PostgreSQL).

The parametrised ``storage`` fixture lives in ``conftest.py``.
"""

from storage_contract import HealthContract, RunContract, TemplateContract


class TestTemplateStore(TemplateContract):
    pass


class TestQueryRunStore(RunContract):
    pass


class TestStorageHealth(HealthContract):
    pass
