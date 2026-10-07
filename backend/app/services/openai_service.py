import json
import os
from datetime import date, timezone
from datetime import datetime as dt

from openai import AsyncOpenAI

from ..schema import ISSUE_TAXONOMY, ExtractedClaim

client = AsyncOpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

TRANSCRIBE_MODEL = os.environ.get("OPENAI_TRANSCRIBE_MODEL", "gpt-4o-transcribe")
LLM_MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")

EXTRACTED_CLAIM_FIELDS = [
    "issueType",
    "subType",
    "description",
    "confidence",
]

_TAXONOMY_LINES = "\n".join(
    f'- "{issue}" → sub-type must be one of: {", ".join(subs)}' for issue, subs in ISSUE_TAXONOMY.items()
)

EXTRACTION_SYSTEM_PROMPT = f"""You are a telecom customer support intake assistant.
Extract a structured complaint from the customer's spoken statement.

Rules:
- Only use information explicitly stated or very strongly implied by the transcript. Never invent details.
- issueType must be exactly one of the issue types below, and subType must be exactly one of that issue type's listed sub-types (use "Other" within that issue type if nothing else fits):
{_TAXONOMY_LINES}
- description is a concise 1-2 sentence restatement of the problem, in your own words, based only on what the customer said.
- If you cannot confidently determine a field, return null for it. Do not guess.
- Return a confidence score (0 to 1) per field you did fill in, in the "confidence" object, keyed by field name.
- Respond with JSON only, matching the provided schema exactly."""


class SpeechToTextError(Exception):
    pass


class ExtractionError(Exception):
    pass


async def transcribe_audio(data: bytes, filename: str, content_type: str) -> str:
    try:
        result = await client.audio.transcriptions.create(
            file=(filename, data, content_type),
            model=TRANSCRIBE_MODEL,
        )
        text = (result.text or "").strip()
        if not text:
            raise SpeechToTextError("No speech was detected in the recording.")
        return text
    except SpeechToTextError:
        raise
    except Exception as exc:
        raise SpeechToTextError("Could not convert speech to text.") from exc


def _normalize_llm_json(obj: dict) -> dict:
    """The model sometimes omits null fields entirely instead of including
    them; backfill so the strict schema always validates."""
    return {field: obj.get(field, None) for field in EXTRACTED_CLAIM_FIELDS}


async def extract_claim_from_transcript(transcript: str) -> ExtractedClaim:
    today: date = dt.now(timezone.utc).date()

    try:
        completion = await client.chat.completions.create(
            model=LLM_MODEL,
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": EXTRACTION_SYSTEM_PROMPT},
                {
                    "role": "user",
                    "content": (
                        f"Current date: {today.isoformat()}\n\n"
                        f'Customer statement:\n"""{transcript}"""\n\n'
                        "Extract the complaint fields as a JSON object with exactly these keys: "
                        "issueType, subType, description, confidence."
                    ),
                },
            ],
        )

        raw = completion.choices[0].message.content
        if not raw:
            raise ExtractionError("The AI did not return a result.")

        parsed = json.loads(raw)
        normalized = _normalize_llm_json(parsed)
        return ExtractedClaim.model_validate(normalized)
    except ExtractionError:
        raise
    except Exception as exc:
        raise ExtractionError("Could not understand the complaint details from your statement.") from exc
