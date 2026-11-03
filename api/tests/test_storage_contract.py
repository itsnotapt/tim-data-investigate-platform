"""Runs the tests of the storage's interface in ``storage_contract.py``.

The ``storage`` fixture lives in ``conftest.py``.
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
