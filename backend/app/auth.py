import os
import secrets
import time
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select, func
from .db import COOKIE, get_db, hash_token
from .models import User
from .people import LoginAttempt, Session

hasher = PasswordHasher()
DUMMY_HASH = hasher.hash(secrets.token_urlsafe(32))


def verify(password, encoded):
    try:
        return hasher.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def authenticate(request: Request, db=Depends(get_db, scope="function")):
    """The signed-in person's own settings row, from their own ledger. `get_db` chose the ledger."""
    session = request.state.session
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session.csrf):
            raise HTTPException(403, "Invalid CSRF token")
    return db.scalar(select(User))


def start_session(people, person, profile, response: Response):
    people.execute(delete(Session).where(Session.expires <= int(time.time())))
    token = secrets.token_urlsafe(48)
    session = Session(
        token_hash=hash_token(token),
        person_id=person.id,
        csrf=secrets.token_urlsafe(32),
        expires=int(time.time()) + 12 * 3600,
    )
    people.add(session)
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        samesite="strict",
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        max_age=43200,
        path="/",
    )
    return {"username": person.username, "csrf": session.csrf, "demo": profile.demo}


def throttle(people, request):
    client = request.client.host if request.client else "local"
    cutoff = int(time.time()) - 900
    people.execute(delete(LoginAttempt).where(LoginAttempt.at < cutoff))
    count = people.scalar(select(func.count()).select_from(LoginAttempt).where(LoginAttempt.client == client))
    if count >= 10:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    people.add(LoginAttempt(client=client, at=int(time.time())))
    # Persist failed attempts even when the endpoint raises an HTTP error.
    people.commit()
