from datetime import datetime, timezone
from typing import Optional

from ..db import connect


def _out(row) -> dict:
    return {
        "caseId": row["case_id"],
        "assignmentId": row["assignment_id"],
        "customerId": row["customer_id"],
        "issueType": row["issue"],
        "subType": row["subtype"],
        "description": row["description"] or "",
        "createdAt": row["created_at"],
    }


def save_complaint(
    customer_id: str, case_id: str, assignment_id: Optional[str], issue: str, subtype: str, description: str
) -> None:
    with connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO complaints "
            "(case_id, customer_id, assignment_id, issue, subtype, description, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            (case_id, customer_id, assignment_id, issue, subtype, description, datetime.now(timezone.utc).isoformat()),
        )


# Every read is scoped by customer_id, so a customer can never see anyone
# else's complaints.
def list_complaints(customer_id: str) -> list[dict]:
    with connect() as conn:
        rows = conn.execute(
            "SELECT * FROM complaints WHERE customer_id = ? ORDER BY created_at DESC", (customer_id,)
        ).fetchall()
        return [_out(r) for r in rows]


def get_complaint(customer_id: str, case_id: str) -> Optional[dict]:
    with connect() as conn:
        row = conn.execute(
            "SELECT * FROM complaints WHERE customer_id = ? AND case_id = ?", (customer_id, case_id)
        ).fetchone()
        return _out(row) if row else None
