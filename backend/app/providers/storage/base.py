"""Storage provider contract.

Objects are addressed by an opaque ``storage_key``; only the provider knows
whether that is a path on disk or an S3 object key. Nothing above this layer
constructs URLs by hand.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable


@dataclass(slots=True)
class StoredObject:
    storage_key: str
    url: str
    size_bytes: int
    content_type: str


@runtime_checkable
class StorageProvider(Protocol):
    name: str

    def save(self, data: bytes, *, filename: str, content_type: str, folder: str) -> StoredObject:
        ...

    def load(self, storage_key: str) -> bytes:
        ...

    def delete(self, storage_key: str) -> None:
        ...

    def url_for(self, storage_key: str) -> str:
        ...
