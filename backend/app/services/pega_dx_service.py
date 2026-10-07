import base64
import os
import time
import urllib.parse
from contextlib import asynccontextmanager
from typing import Optional

import httpx

from ..schema import ClaimDraft

# Pega DX API integration. Runs server-side only — the client secret never
# reaches the browser. The frontend calls POST /api/claims on our own
# backend; this module is the only thing that talks to Pega.

PEGA_BASE_URL = os.environ.get("PEGA_DX_BASE_URL", "").rstrip("/")
PEGA_CLIENT_ID = os.environ.get("PEGA_CLIENT_ID", "")
PEGA_CLIENT_SECRET = os.environ.get("PEGA_CLIENT_SECRET", "")
PEGA_CASE_TYPE_ID = os.environ.get("PEGA_CASE_TYPE_ID", "")
PEGA_TOKEN_URL = os.environ.get("PEGA_TOKEN_URL") or (
    f"{PEGA_BASE_URL}/PRRestService/oauth2/v1/token" if PEGA_BASE_URL else ""
)

# Pega property that holds the Customer ID on the case (pyWorkPage). Left
# empty until the property exists in Pega — an unknown property makes the DX
# API reject case creation. Dotted paths nest, e.g. "IssueDetails.CustomerID".
PEGA_CUSTOMER_ID_FIELD = os.environ.get("PEGA_CUSTOMER_ID_FIELD", "").strip()

# Data view that returns every case belonging to one customer. The Customer ID
# is passed as the value of its single parameter (AccNum).
PEGA_CUSTOMER_DATA_VIEW = os.environ.get("PEGA_CUSTOMER_DATA_VIEW", "D_FetchRequestCases_Customer")
PEGA_CUSTOMER_DATA_VIEW_PARAM = os.environ.get("PEGA_CUSTOMER_DATA_VIEW_PARAM", "AccNum")
# The data view returns the short ID (S-1024); the full case ID adds this prefix.
PEGA_CASE_ID_PREFIX = os.environ.get("PEGA_CASE_ID_PREFIX", "GNET-TELECOM-WORK")

_REQUEST_TIMEOUT = 20.0

# One long-lived HTTP client: reuses the TLS connection to Pega instead of
# paying a fresh handshake on every call.
_http_client: Optional[httpx.AsyncClient] = None


@asynccontextmanager
async def _shared_client():
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=_REQUEST_TIMEOUT)
    yield _http_client


# Short-lived per-customer cache of the data view result, so opening a
# complaint right after the list doesn't hit Pega for the same rows again.
_CASES_TTL_SECONDS = 20.0
_cases_cache: dict[str, tuple[float, list[dict]]] = {}


def invalidate_customer_cases(customer_id: str) -> None:
    _cases_cache.pop(customer_id, None)


class PegaConfigError(Exception):
    pass


class PegaAuthError(Exception):
    pass


class PegaApiError(Exception):
    pass


def is_configured() -> bool:
    return bool(PEGA_BASE_URL and PEGA_CLIENT_ID and PEGA_CLIENT_SECRET and PEGA_CASE_TYPE_ID)


def _require_configured() -> None:
    if not is_configured():
        raise PegaConfigError(
            "Pega DX API isn't configured. Set PEGA_DX_BASE_URL, PEGA_CLIENT_ID, "
            "PEGA_CLIENT_SECRET and PEGA_CASE_TYPE_ID in backend/.env."
        )


# In-memory token cache — one process-wide client-credentials token, renewed
# a little before it actually expires.
_token_cache: dict[str, object] = {}


async def _get_access_token() -> str:
    _require_configured()

    now = time.time()
    cached_token = _token_cache.get("token")
    expires_at = _token_cache.get("expires_at", 0)
    if isinstance(cached_token, str) and isinstance(expires_at, (int, float)) and now < expires_at - 30:
        return cached_token

    basic = base64.b64encode(f"{PEGA_CLIENT_ID}:{PEGA_CLIENT_SECRET}".encode()).decode()

    async with _shared_client() as client:
        try:
            resp = await client.post(
                PEGA_TOKEN_URL,
                headers={
                    "Authorization": f"Basic {basic}",
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                data={"grant_type": "client_credentials"},
            )
        except httpx.TimeoutException as exc:
            raise PegaAuthError("Timed out contacting the Pega authentication server.") from exc
        except httpx.RequestError as exc:
            raise PegaAuthError("Could not reach the Pega authentication server.") from exc

    if resp.status_code != 200:
        raise PegaAuthError(f"Pega authentication failed (HTTP {resp.status_code}).")

    try:
        body = resp.json()
    except ValueError as exc:
        raise PegaAuthError("Pega authentication server returned an unexpected response.") from exc

    token = body.get("access_token")
    if not token or not isinstance(token, str):
        raise PegaAuthError("Pega authentication response did not include an access token.")

    expires_in = body.get("expires_in", 600)
    try:
        expires_in = float(expires_in)
    except (TypeError, ValueError):
        expires_in = 600.0

    _token_cache["token"] = token
    _token_cache["expires_at"] = now + expires_in
    return token


def _extract_path(data: dict, candidate_paths: list[tuple[str, ...]]) -> Optional[str]:
    for path in candidate_paths:
        node: object = data
        for key in path:
            if not isinstance(node, dict) or key not in node:
                node = None
                break
            node = node[key]
        if isinstance(node, str) and node:
            return node
    return None


def _extract_case_id(data: dict) -> Optional[str]:
    """Pega's v2 case-creation response shape varies by version — try the
    common locations rather than assuming one exact structure."""
    return _extract_path(
        data,
        [
            ("ID",),
            ("caseInfo", "ID"),
            ("data", "caseInfo", "ID"),
            ("pyID",),
        ],
    )


def _extract_assignment_id(data: dict) -> Optional[str]:
    """The newly created case's next assignment — e.g.
    'ASSIGN-WORKLIST GNet-Telecom-Work-ServiceRequest S-1005!REQUESTINTAKE_FLOW' —
    confirmed live at data.nextAssignmentInfo.ID, with the case's own
    assignments list as a fallback."""
    direct = _extract_path(data, [("nextAssignmentInfo", "ID")])
    if direct:
        return direct

    assignments = None
    for path in (("data", "caseInfo", "assignments"), ("caseInfo", "assignments")):
        node: object = data
        for key in path:
            if not isinstance(node, dict) or key not in node:
                node = None
                break
            node = node[key]
        if isinstance(node, list) and node:
            assignments = node
            break

    if assignments:
        first = assignments[0]
        if isinstance(first, dict) and isinstance(first.get("ID"), str):
            return first["ID"]

    return None


async def create_case(draft: ClaimDraft, customer_id: str) -> dict:
    """Creates the complaint as a case in Pega via the DX API. Returns
    {"caseId": str, "raw": dict} on success."""
    _require_configured()

    token = await _get_access_token()

    payload = {
        "caseTypeID": PEGA_CASE_TYPE_ID,
        "content": {
            "IssueDetails": {
                "Issue": draft.issueType,
                "Subtype": draft.subType,
                "Description": draft.description,
            }
        },
    }

    if PEGA_CUSTOMER_ID_FIELD:
        node = payload["content"]
        *parents, leaf = PEGA_CUSTOMER_ID_FIELD.split(".")
        for key in parents:
            node = node.setdefault(key, {})
        node[leaf] = customer_id

    url = f"{PEGA_BASE_URL}/api/application/v2/cases?viewType=none"

    async with _shared_client() as client:
        try:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=payload,
            )
        except httpx.TimeoutException as exc:
            raise PegaApiError("Timed out creating the case in Pega.") from exc
        except httpx.RequestError as exc:
            raise PegaApiError("Could not reach the Pega DX API.") from exc

    if resp.status_code not in (200, 201):
        # Pega error bodies can be large; keep the slice bounded and never
        # include request headers (which could carry the bearer token).
        raise PegaApiError(f"Pega case creation failed (HTTP {resp.status_code}): {resp.text[:300]}")

    try:
        data = resp.json()
    except ValueError as exc:
        raise PegaApiError("Pega returned an unexpected response while creating the case.") from exc

    case_id = _extract_case_id(data)
    if not case_id:
        raise PegaApiError("Pega created the case but did not return a case ID.")

    # Not fatal if missing — the case still exists — but the frontend needs
    # this to open the assignment in the Pega Web Embed.
    assignment_id = _extract_assignment_id(data)

    return {"caseId": case_id, "assignmentId": assignment_id, "raw": data}


async def get_case_details(case_id: str) -> Optional[dict]:
    """Latest state of one case straight from Pega (status, stage, dates)."""
    _require_configured()
    token = await _get_access_token()
    url = f"{PEGA_BASE_URL}/api/application/v2/cases/{urllib.parse.quote(case_id)}"

    async with _shared_client() as client:
        try:
            resp = await client.get(url, headers={"Authorization": f"Bearer {token}"})
        except httpx.RequestError as exc:
            raise PegaApiError("Could not reach the Pega DX API.") from exc

    if resp.status_code == 404:
        return None
    if resp.status_code != 200:
        raise PegaApiError(f"Pega case lookup failed (HTTP {resp.status_code}).")

    try:
        data = resp.json()
    except ValueError as exc:
        raise PegaApiError("Pega returned an unexpected response.") from exc

    info = (data.get("data") or {}).get("caseInfo") or data.get("caseInfo") or {}
    content = info.get("content") or {}
    details = content.get("IssueDetails") or {}
    assignments = info.get("assignments") or []
    current_task = assignments[0].get("name") if assignments and isinstance(assignments[0], dict) else None

    return {
        "status": info.get("status"),
        "stage": info.get("stageLabel") or info.get("stageID"),
        "currentTask": current_task,
        "createdAt": info.get("createTime"),
        "updatedAt": info.get("lastUpdateTime"),
        "issueType": details.get("Issue"),
        "subType": details.get("Subtype"),
        "description": details.get("Description"),
        "customerId": content.get(PEGA_CUSTOMER_ID_FIELD) if PEGA_CUSTOMER_ID_FIELD and "." not in PEGA_CUSTOMER_ID_FIELD else None,
    }


async def fetch_customer_cases(customer_id: str) -> list[dict]:
    """All cases for one customer, via the Pega data view, newest first."""
    cached = _cases_cache.get(customer_id)
    if cached and time.time() - cached[0] < _CASES_TTL_SECONDS:
        return cached[1]

    _require_configured()
    token = await _get_access_token()
    url = f"{PEGA_BASE_URL}/api/application/v2/data_views/{PEGA_CUSTOMER_DATA_VIEW}"

    async with _shared_client() as client:
        try:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={"dataViewParameters": {PEGA_CUSTOMER_DATA_VIEW_PARAM: customer_id}},
            )
        except httpx.TimeoutException as exc:
            raise PegaApiError("Timed out fetching your complaints from Pega.") from exc
        except httpx.RequestError as exc:
            raise PegaApiError("Could not reach the Pega DX API.") from exc

    if resp.status_code != 200:
        raise PegaApiError(f"Pega data view failed (HTTP {resp.status_code}).")
    try:
        rows = resp.json().get("data") or []
    except ValueError as exc:
        raise PegaApiError("Pega returned an unexpected response.") from exc

    cases = []
    for row in rows:
        if not isinstance(row, dict) or not row.get("pyID"):
            continue
        owner = (row.get("Customer") or {}).get("AccountNumber")
        # Belt and braces: never surface a row that isn't this customer's.
        if owner != customer_id:
            continue
        details = row.get("IssueDetails") or {}
        notes = row.get("ResolutionNotes") or {}
        short_id = row["pyID"]
        cases.append(
            {
                "caseId": f"{PEGA_CASE_ID_PREFIX} {short_id}",
                "shortId": short_id,
                "customerId": owner,
                "status": row.get("pyStatusWork"),
                "issueType": details.get("Issue") or "",
                "subType": details.get("Subtype") or "",
                "description": details.get("Description") or "",
                "resolutionNotes": notes.get("ResolutionNotes"),
                "actionItemsCompleted": notes.get("ActionItemsCompleted"),
            }
        )

    def _num(case: dict) -> int:
        digits = "".join(ch for ch in case["shortId"] if ch.isdigit())
        return int(digits) if digits else 0

    result = sorted(cases, key=_num, reverse=True)
    _cases_cache[customer_id] = (time.time(), result)
    return result
