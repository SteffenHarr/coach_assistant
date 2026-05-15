"""Authentication: fastapi-users with Argon2 password hashing + JWT.

Roles are stored as ``UserORM.role`` and checked via FastAPI dependencies.
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Depends, HTTPException, status
from fastapi_users import BaseUserManager, FastAPIUsers, UUIDIDMixin
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)
from fastapi_users.db import SQLAlchemyUserDatabase
from fastapi_users.password import PasswordHelperProtocol
from sqlalchemy.ext.asyncio import AsyncSession

from coach_api.config import get_settings
from coach_api.infrastructure.db import get_db
from coach_api.infrastructure.models import UserORM, UserRole

_settings = get_settings()
_ph = PasswordHasher()  # Argon2id with secure defaults


class Argon2PasswordHelper(PasswordHelperProtocol):
    def verify_and_update(self, plain_password: str, hashed_password: str) -> tuple[bool, str | None]:
        try:
            _ph.verify(hashed_password, plain_password)
        except VerifyMismatchError:
            return False, None
        if _ph.check_needs_rehash(hashed_password):
            return True, _ph.hash(plain_password)
        return True, None

    def hash(self, password: str) -> str:
        return _ph.hash(password)

    def generate(self) -> str:
        import secrets

        return secrets.token_urlsafe(32)


async def get_user_db(session: AsyncSession = Depends(get_db)) -> AsyncIterator[SQLAlchemyUserDatabase]:
    yield SQLAlchemyUserDatabase(session, UserORM)


class UserManager(UUIDIDMixin, BaseUserManager[UserORM, uuid.UUID]):
    reset_password_token_secret = _settings.api_secret_key.get_secret_value()
    verification_token_secret = _settings.api_secret_key.get_secret_value()


async def get_user_manager(
    user_db: SQLAlchemyUserDatabase = Depends(get_user_db),
) -> AsyncIterator[UserManager]:
    yield UserManager(user_db, password_helper=Argon2PasswordHelper())


bearer_transport = BearerTransport(tokenUrl="auth/jwt/login")


def get_jwt_strategy() -> JWTStrategy:
    return JWTStrategy(
        secret=_settings.api_secret_key.get_secret_value(),
        lifetime_seconds=_settings.api_jwt_access_ttl_seconds,
        algorithm="HS256",
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[UserORM, uuid.UUID](get_user_manager, [auth_backend])

current_active_user = fastapi_users.current_user(active=True)


def require_role(*allowed: UserRole):
    """Dependency factory: ensure the active user has one of the given roles."""

    async def _dep(user: UserORM = Depends(current_active_user)) -> UserORM:
        if user.is_superuser:
            return user
        if user.role not in allowed:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "insufficient role")
        return user

    return _dep
