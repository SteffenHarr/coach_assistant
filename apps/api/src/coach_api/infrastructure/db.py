"""SQLAlchemy 2 async engine + session factory."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from coach_api.config import get_settings


class Base(DeclarativeBase):
    """Base for all ORM models."""


def _make_async_url(url: str) -> str:
    # Convert ``postgresql+psycopg://`` (sync driver) to ``postgresql+psycopg_async``
    # is not needed — psycopg 3 supports async with the same driver name.
    return url


_settings = get_settings()
engine = create_async_engine(
    _make_async_url(_settings.database_url),
    pool_pre_ping=True,
    future=True,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
