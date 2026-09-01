"""Shared response shapes."""

from __future__ import annotations

from typing import Generic, TypeVar

from pydantic import BaseModel, ConfigDict, Field

T = TypeVar("T")


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    page: int
    page_size: int

    @property
    def pages(self) -> int:
        return max(1, -(-self.total // self.page_size))


class PageMeta(BaseModel):
    total: int
    page: int
    page_size: int
    pages: int
    has_next: bool
    has_previous: bool


class PaginatedResponse(BaseModel, Generic[T]):
    items: list[T]
    meta: PageMeta

    @classmethod
    def build(cls, items: list[T], total: int, page: int, page_size: int) -> PaginatedResponse[T]:
        pages = max(1, -(-total // page_size)) if page_size else 1
        return cls(
            items=items,
            meta=PageMeta(
                total=total,
                page=page,
                page_size=page_size,
                pages=pages,
                has_next=page < pages,
                has_previous=page > 1,
            ),
        )


class MessageResponse(BaseModel):
    message: str
    detail: str | None = None


class ErrorBody(BaseModel):
    code: str
    message: str
    details: dict | None = None


class ErrorResponse(BaseModel):
    """The envelope every failure uses."""

    error: ErrorBody


class HealthResponse(BaseModel):
    status: str = Field(examples=["ok"])
    environment: str
    database: str
    ai_provider: str
    ai_service: str
    version: str
