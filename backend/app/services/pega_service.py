import asyncio
import random
from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel

from ..schema import ClaimDraft

# Mock implementation of a Pega Constellation DX API client. Method names
# mirror what a real DX-backed client would expose (create_case / get_case /
# update_case_fields / submit_case), so swapping this module for one that
# calls the real Pega DX API later requires no changes to routes/claims.py.

PegaCaseStatus = Literal["Created", "PendingReview", "Submitted"]


class HistoryEntry(BaseModel):
    timestamp: str
    action: str
    note: Optional[str] = None


class PegaCase(BaseModel):
    caseId: str
    caseTypeId: str
    status: PegaCaseStatus
    createdAt: str
    updatedAt: str
    content: ClaimDraft
    history: list[HistoryEntry]


_store: dict[str, PegaCase] = {}
_sequence = 100123


def _next_case_id() -> str:
    global _sequence
    _sequence += 1
    return f"CLM-{_sequence}"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _simulate_latency() -> None:
    await asyncio.sleep((250 + random.randint(0, 350)) / 1000)


async def create_case(content: ClaimDraft) -> PegaCase:
    await _simulate_latency()
    now = _now()
    pega_case = PegaCase(
        caseId=_next_case_id(),
        caseTypeId="TeleCare-Claims-Work-Claim",
        status="Created",
        createdAt=now,
        updatedAt=now,
        content=content,
        history=[HistoryEntry(timestamp=now, action="Claim created", note="Created via voice intake")],
    )
    _store[pega_case.caseId] = pega_case
    return pega_case


async def get_case(case_id: str) -> Optional[PegaCase]:
    await _simulate_latency()
    return _store.get(case_id)


async def update_case_fields(case_id: str, updates: dict) -> Optional[PegaCase]:
    await _simulate_latency()
    existing = _store.get(case_id)
    if not existing:
        return None

    updated_content = existing.content.model_copy(update=updates)
    now = _now()
    updated = existing.model_copy(
        update={
            "content": updated_content,
            "status": "PendingReview",
            "updatedAt": now,
            "history": existing.history
            + [HistoryEntry(timestamp=now, action="Fields updated", note="Reviewed and corrected by customer")],
        }
    )
    _store[case_id] = updated
    return updated


async def submit_case(case_id: str) -> Optional[PegaCase]:
    await _simulate_latency()
    existing = _store.get(case_id)
    if not existing:
        return None

    now = _now()
    updated = existing.model_copy(
        update={
            "status": "Submitted",
            "updatedAt": now,
            "history": existing.history
            + [HistoryEntry(timestamp=now, action="Claim submitted", note="Workflow continues in Pega")],
        }
    )
    _store[case_id] = updated
    return updated
