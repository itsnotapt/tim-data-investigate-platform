"""The errors the storage raises."""


class StorageError(Exception):
    """Base class for storage failures."""


class NotFoundError(StorageError):
    """The addressed record does not exist."""


class AlreadyExistsError(StorageError):
    """A record with the same key already exists."""


class StorageUnavailableError(StorageError):
    """The backing store cannot be reached."""
