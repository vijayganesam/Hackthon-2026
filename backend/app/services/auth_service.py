import hashlib
import hmac
import re
import secrets
import sqlite3
import time
from datetime import datetime, timezone
from typing import Optional

from ..db import connect

SESSION_TTL_SECONDS = 12 * 60 * 60
_PBKDF2_ROUNDS = 200_000
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class AuthError(Exception):
    pass


def _hash_password(password: str, salt: str) -> str:
    return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), _PBKDF2_ROUNDS).hex()


def _public(row: sqlite3.Row) -> dict:
    return {"customerId": row["customer_id"], "name": row["name"], "email": row["email"], "phone": row["phone"]}


def register_customer(name: str, email: str, phone: str, password: str) -> dict:
    name, email, phone = name.strip(), email.strip().lower(), phone.strip()
    if not name:
        raise AuthError("Please enter your name.")
    if not _EMAIL_RE.match(email):
        raise AuthError("Please enter a valid email address.")
    digits = re.sub(r"\D", "", phone)
    if not 7 <= len(digits) <= 15:
        raise AuthError("Please enter a valid phone number.")
    if len(password) < 8:
        raise AuthError("Password must be at least 8 characters.")

    salt = secrets.token_hex(16)
    with connect() as conn:
        try:
            cur = conn.execute(
                "INSERT INTO customers (name, email, phone, password_hash, password_salt, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (name, email, phone, _hash_password(password, salt), salt, datetime.now(timezone.utc).isoformat()),
            )
        except sqlite3.IntegrityError as exc:
            raise AuthError("An account with this email already exists. Please sign in.") from exc
        customer_id = f"CUST-{1000 + cur.lastrowid}"
        conn.execute("UPDATE customers SET customer_id = ? WHERE id = ?", (customer_id, cur.lastrowid))
        row = conn.execute("SELECT * FROM customers WHERE id = ?", (cur.lastrowid,)).fetchone()
        return _public(row)


def login_customer(email: str, password: str) -> tuple[str, dict]:
    with connect() as conn:
        row = conn.execute("SELECT * FROM customers WHERE email = ?", (email.strip().lower(),)).fetchone()
        # Same message for unknown email and wrong password.
        if not row or not hmac.compare_digest(_hash_password(password, row["password_salt"]), row["password_hash"]):
            raise AuthError("Incorrect email or password.")
        token = secrets.token_urlsafe(32)
        conn.execute("DELETE FROM sessions WHERE expires_at < ?", (time.time(),))
        conn.execute(
            "INSERT INTO sessions (token, customer_id, expires_at) VALUES (?, ?, ?)",
            (token, row["customer_id"], time.time() + SESSION_TTL_SECONDS),
        )
        return token, _public(row)


def customer_for_token(token: str) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute(
            "SELECT c.* FROM sessions s JOIN customers c ON c.customer_id = s.customer_id "
            "WHERE s.token = ? AND s.expires_at > ?",
            (token, time.time()),
        ).fetchone()
        return _public(row) if row else None


def logout(token: str) -> None:
    with connect() as conn:
        conn.execute("DELETE FROM sessions WHERE token = ?", (token,))
