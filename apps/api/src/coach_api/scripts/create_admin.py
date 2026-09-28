"""One-off CLI to bootstrap the very first admin account.

Self-registration is intentionally disabled (see ``main.py``), and creating
a user via ``POST /admin/users`` itself requires an *existing* admin — so
there is no way to create the first account through the API at all. Run
this once instead, from inside the ``api`` container::

    docker compose --env-file .env -f deploy/docker-compose.yml exec api \\
        python -m coach_api.scripts.create_admin admin@dein-verein.de "ein-sehr-langes-passwort"
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select

from coach_api.infrastructure.auth import Argon2PasswordHelper
from coach_api.infrastructure.db import SessionLocal
from coach_api.infrastructure.models import UserORM, UserRole


async def create_admin(email: str, password: str) -> None:
    if len(password) < 12:
        print("Fehler: Passwort muss mindestens 12 Zeichen lang sein.", file=sys.stderr)
        raise SystemExit(1)
    async with SessionLocal() as db:
        existing = (
            await db.execute(select(UserORM).where(UserORM.email == email))
        ).scalar_one_or_none()
        if existing is not None:
            print(f"Fehler: Ein Benutzer mit der E-Mail {email} existiert bereits.", file=sys.stderr)
            raise SystemExit(1)
        user = UserORM(
            email=email,
            hashed_password=Argon2PasswordHelper().hash(password),
            role=UserRole.ADMIN,
            is_active=True,
            is_verified=True,
            is_superuser=True,
        )
        db.add(user)
        await db.commit()
    print(f"Admin-Account angelegt: {email}")


def main() -> None:
    if len(sys.argv) != 3:
        print("Nutzung: python -m coach_api.scripts.create_admin <email> <passwort>", file=sys.stderr)
        raise SystemExit(1)
    asyncio.run(create_admin(sys.argv[1], sys.argv[2]))


if __name__ == "__main__":
    main()
