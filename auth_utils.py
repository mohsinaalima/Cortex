"""Small standard-library password and signed-token helpers for the API."""

import base64
import hashlib
import hmac
import json
import os
import secrets
import time


TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7
SCRYPT_N = 2**14


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def _signing_key() -> bytes:
    value = os.getenv("AUTH_SECRET_KEY", "")
    if len(value.encode("utf-8")) < 32:
        raise RuntimeError("AUTH_SECRET_KEY must contain at least 32 bytes.")
    return value.encode("utf-8")


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=8, p=1, dklen=32)
    return f"scrypt${SCRYPT_N}$8$1${_b64encode(salt)}${_b64encode(digest)}"


def verify_password(password: str, encoded: str) -> bool:
    if not isinstance(encoded, str):
        return False
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$", 5)
        if algorithm != "scrypt":
            return False
        actual = hashlib.scrypt(
            password.encode("utf-8"), salt=_b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32
        )
        return hmac.compare_digest(actual, _b64decode(expected))
    except (ValueError, TypeError, MemoryError):
        return False


def create_access_token(user_id: str, email: str) -> str:
    now = int(time.time())
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    payload = _b64encode(json.dumps({"sub": user_id, "email": email, "iat": now, "exp": now + TOKEN_TTL_SECONDS}, separators=(",", ":")).encode())
    message = f"{header}.{payload}".encode("ascii")
    signature = _b64encode(hmac.new(_signing_key(), message, hashlib.sha256).digest())
    return f"{header}.{payload}.{signature}"


def decode_access_token(token: str) -> dict | None:
    try:
        header, payload, signature = token.split(".", 2)
        if json.loads(_b64decode(header)).get("alg") != "HS256":
            return None
        message = f"{header}.{payload}".encode("ascii")
        expected = hmac.new(_signing_key(), message, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signature)):
            return None
        claims = json.loads(_b64decode(payload))
        if not claims.get("sub") or int(claims.get("exp", 0)) <= int(time.time()):
            return None
        return claims
    except (ValueError, TypeError, RuntimeError, json.JSONDecodeError):
        return None
