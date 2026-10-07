import asyncio

from fastapi import APIRouter, Depends, HTTPException

from ..auth import current_customer
from ..services import complaint_store
from ..services.pega_dx_service import fetch_customer_cases, get_case_details, invalidate_customer_cases

router = APIRouter(prefix="/api/complaints", tags=["complaints"])


# The Customer ID comes from the session token, never from a request
# parameter, so a caller can only ever ask for their own complaints.
@router.get("")
async def list_my_complaints(fresh: bool = False, customer: dict = Depends(current_customer)):
    customer_id = customer["customerId"]
    if fresh:
        # Skip the short-lived cache — used right after a new case is created.
        invalidate_customer_cases(customer_id)
    try:
        cases = await fetch_customer_cases(customer_id)
        return {"success": True, "source": "pega", "complaints": cases}
    except Exception:
        # Pega unreachable — fall back to what we recorded when each was raised.
        local = complaint_store.list_complaints(customer_id)
        for item in local:
            item["status"] = None
        return {"success": True, "source": "local", "complaints": local}


@router.get("/{case_id}")
async def complaint_details(case_id: str, customer: dict = Depends(current_customer)):
    customer_id = customer["customerId"]

    # The ownership/status lookup and the live case lookup are independent, so
    # run them together instead of one after the other.
    cases_result, live_result = await asyncio.gather(
        fetch_customer_cases(customer_id),
        get_case_details(case_id),
        return_exceptions=True,
    )

    record = None
    if isinstance(cases_result, Exception):
        local = complaint_store.get_complaint(customer_id, case_id)
        if local:
            record = {**local, "status": None}
    else:
        record = next((c for c in cases_result if c["caseId"] == case_id), None)

    if not record:
        # Same response whether the case doesn't exist or belongs to someone else.
        raise HTTPException(status_code=404, detail="Complaint not found.")

    live = None if isinstance(live_result, Exception) else live_result
    return {"success": True, "complaint": {**record, "live": live}}
