import hashlib
import os
import secrets
import time
from argon2 import PasswordHasher
from argon2.exceptions import VerificationError, InvalidHashError
from fastapi import Depends, HTTPException, Request, Response
from sqlalchemy import delete, select, func
from .db import get_db
from .models import Session, User, LoginAttempt

hasher = PasswordHasher()
DUMMY_HASH = hasher.hash(secrets.token_urlsafe(32))
COOKIE = "ledger_session"


def hash_token(token):
    return hashlib.sha256(token.encode()).hexdigest()


def verify(password, encoded):
    try:
        return hasher.verify(encoded, password)
    except (VerificationError, InvalidHashError):
        return False


def authenticate(request: Request, db=Depends(get_db, scope="function")):
    token = request.cookies.get(COOKIE, "")
    session = db.get(Session, hash_token(token)) if token else None
    if not session or session.expires <= int(time.time()):
        raise HTTPException(401, "Please sign in")
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        if not secrets.compare_digest(request.headers.get("x-csrf-token", ""), session.csrf):
            raise HTTPException(403, "Invalid CSRF token")
    request.state.session = session
    return db.get(User, session.user_id)


def start_session(db, user, response: Response):
    db.execute(delete(Session).where(Session.expires <= int(time.time())))
    token = secrets.token_urlsafe(48)
    session = Session(
        token_hash=hash_token(token),
        user_id=user.id,
        csrf=secrets.token_urlsafe(32),
        expires=int(time.time()) + 12 * 3600,
    )
    db.add(session)
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        samesite="strict",
        secure=os.getenv("COOKIE_SECURE", "false").lower() == "true",
        max_age=43200,
        path="/",
    )
    return {"username": user.username, "csrf": session.csrf, "demo": user.demo}


def throttle(db, request):
    client = request.client.host if request.client else "local"
    cutoff = int(time.time()) - 900
    db.execute(delete(LoginAttempt).where(LoginAttempt.at < cutoff))
    count = db.scalar(select(func.count()).select_from(LoginAttempt).where(LoginAttempt.client == client))
    if count >= 10:
        raise HTTPException(429, "Too many attempts. Try again in 15 minutes.")
    db.add(LoginAttempt(client=client, at=int(time.time())))
    # Persist failed attempts even when the endpoint raises an HTTP error.
    db.commit()
