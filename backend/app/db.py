import os
import sqlite3
from contextlib import contextmanager

# Local SQLite store for customers, login sessions and the complaints each
# customer has raised. Lives next to the backend; created on first use.
DB_PATH = os.environ.get("APP_DB_PATH") or os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "app.db")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id TEXT UNIQUE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    expires_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS complaints (
    case_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    assignment_id TEXT,
    issue TEXT NOT NULL,
    subtype TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_complaints_customer ON complaints (customer_id, created_at);
"""


@contextmanager
def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        conn.executescript(_SCHEMA)
        yield conn
        conn.commit()
    finally:
        conn.close()
