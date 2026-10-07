from pydantic import BaseModel

from .schema import CLAIM_FIELD_DEFINITIONS, ExtractedClaim


class MissingField(BaseModel):
    field: str
    label: str
    prompt: str


class ValidationResult(BaseModel):
    isComplete: bool
    missingFields: list[MissingField]
    issueType: str | None = None


def _is_blank(value) -> bool:
    return value is None or value == ""


def validate_extracted_claim(claim: ExtractedClaim) -> ValidationResult:
    missing_fields: list[MissingField] = []

    for definition in CLAIM_FIELD_DEFINITIONS:
        value = getattr(claim, definition.field)
        if _is_blank(value):
            missing_fields.append(
                MissingField(field=definition.field, label=definition.label, prompt=definition.prompt)
            )

    return ValidationResult(
        isComplete=len(missing_fields) == 0,
        missingFields=missing_fields,
        issueType=claim.issueType,
    )
