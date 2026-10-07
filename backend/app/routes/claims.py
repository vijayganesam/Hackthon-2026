from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..auth import current_customer
from ..schema import ClaimDraft, ExtractedClaim
from ..services.openai_service import (
    ExtractionError,
    SpeechToTextError,
    extract_claim_from_transcript,
    transcribe_audio,
)
from ..services.pega_dx_service import PegaApiError, PegaAuthError, PegaConfigError, invalidate_customer_cases
from ..services.pega_dx_service import create_case as create_pega_dx_case
from ..services import complaint_store
from ..services.pega_service import get_case, submit_case, update_case_fields
from ..validation import validate_extracted_claim

router = APIRouter(prefix="/api/claims", tags=["claims"], dependencies=[Depends(current_customer)])


@router.post("/transcribe")
async def transcribe(audio: UploadFile = File(...)):
    data = await audio.read()
    if not data:
        raise HTTPException(status_code=400, detail="No audio was received. Please try recording again.")
    try:
        transcript = await transcribe_audio(data, audio.filename or "recording.webm", audio.content_type or "audio/webm")
        return {"success": True, "transcript": transcript}
    except SpeechToTextError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail="We couldn't process your recording. Please try again.") from exc


class ExtractRequest(BaseModel):
    transcript: str


@router.post("/extract")
async def extract(body: ExtractRequest):
    if not body.transcript.strip():
        raise HTTPException(status_code=400, detail="A transcript is required.")
    try:
        extracted = await extract_claim_from_transcript(body.transcript)
        validation = validate_extracted_claim(extracted)
        return {"success": True, "extracted": extracted, "validation": validation}
    except ExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500, detail="We couldn't understand the claim details. Please try again."
        ) from exc


@router.post("/validate")
async def validate(body: ExtractedClaim):
    validation = validate_extracted_claim(body)
    return {"success": True, "validation": validation}


@router.post("")
async def create(body: ClaimDraft, customer: dict = Depends(current_customer)):
    # Only reached once the user has reviewed/confirmed the identified
    # Issue + Sub-Type — this is the one place that talks to Pega, and it
    # only ever runs server-side so the client secret never reaches the browser.
    try:
        result = await create_pega_dx_case(body, customer["customerId"])
        invalidate_customer_cases(customer["customerId"])
        complaint_store.save_complaint(
            customer["customerId"],
            result["caseId"],
            result["assignmentId"],
            body.issueType,
            body.subType,
            body.description,
        )
        return {"success": True, "case": {"caseId": result["caseId"], "assignmentId": result["assignmentId"]}}
    except PegaConfigError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except PegaAuthError as exc:
        raise HTTPException(status_code=502, detail=f"Pega authentication failed: {exc}") from exc
    except PegaApiError as exc:
        raise HTTPException(status_code=502, detail=f"We couldn't create your complaint in Pega: {exc}") from exc
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail="We couldn't create your complaint right now. Please try again."
        ) from exc


@router.get("/{case_id}")
async def get(case_id: str):
    pega_case = await get_case(case_id)
    if not pega_case:
        raise HTTPException(status_code=404, detail="Claim not found.")
    return {"success": True, "case": pega_case}


class ClaimDraftPatch(BaseModel):
    issueType: Optional[str] = None
    subType: Optional[str] = None
    description: Optional[str] = None


@router.patch("/{case_id}")
async def update(case_id: str, body: ClaimDraftPatch):
    updates = body.model_dump(exclude_none=True)
    updated = await update_case_fields(case_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Claim not found.")
    return {"success": True, "case": updated}


@router.post("/{case_id}/submit")
async def submit(case_id: str):
    submitted = await submit_case(case_id)
    if not submitted:
        raise HTTPException(status_code=404, detail="Claim not found.")
    return {"success": True, "case": submitted}
