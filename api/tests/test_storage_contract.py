"""Runs the storage contract suite against every implementation (memory and PostgreSQL).

The parametrised ``storage`` fixture lives in ``conftest.py``.
"""

from storage_contract import (
    AnnotationContract,
    ColumnViewContract,
    HealthContract,
    PresetContract,
    RunContract,
)


class TestRunStore(RunContract):
    pass


class TestPresetStore(PresetContract):
    pass


class TestColumnViewStore(ColumnViewContract):
    pass


class TestStorageHealth(HealthContract):
    pass


class TestAnnotationStore(AnnotationContract):
    pass
