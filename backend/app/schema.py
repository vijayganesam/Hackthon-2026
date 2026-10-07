from typing import Literal, Optional

from pydantic import BaseModel, Field

# Issue/Subtype taxonomy — must exactly match the picklist values configured
# on the live Pega case type (GNet-Telecom-Work-ServiceRequest). Verified
# against GET /api/application/v2/casetypes/{ID}/actions/create?viewType=form,
# which returns the valid 'Issue' and 'Subtype' options for that case type.
# Subtype is grouped under an Issue here purely for a friendlier UI — Pega's
# datasource itself offers the same 14 Subtype values for either Issue.
ISSUE_TAXONOMY: dict[str, list[str]] = {
    "Service Request": ["New Connection", "Plan Upgrade", "Plan Change"],
    "Complaint": [
        "Broadband Issue",
        "Mobile Service Issue",
        "Billing Support",
        "SIM Replacement",
        "Network Issue",
        "Poor Call Quality",
        "Internet Connectivity",
        "Billing Complaint",
        "Service Delay",
        "Incorrect Charges",
        "Customer Service Complaint",
    ],
}

IssueType = Literal["Service Request", "Complaint"]
ISSUE_TYPES: list[IssueType] = list(ISSUE_TAXONOMY.keys())  # type: ignore[assignment]


class ExtractedClaim(BaseModel):
    """What the LLM is allowed to return. Every field is optional/nullable —
    missingness is expected and handled by the validation layer, not the model."""

    issueType: Optional[IssueType] = None
    subType: Optional[str] = Field(default=None, description="One of ISSUE_TAXONOMY[issueType]")
    description: Optional[str] = None
    confidence: Optional[dict[str, float]] = None


class ClaimDraft(BaseModel):
    """The validated/editable complaint used once required fields are filled in."""

    issueType: IssueType
    subType: str = Field(min_length=1)
    description: str = Field(min_length=1)


class ClaimFieldDefinition(BaseModel):
    field: str
    label: str
    required_for: Literal["all"]
    prompt: str


# Drives both validation (which fields are required) and the follow-up
# question shown to the user when a required field is missing.
CLAIM_FIELD_DEFINITIONS: list[ClaimFieldDefinition] = [
    ClaimFieldDefinition(
        field="issueType",
        label="Identified Issue",
        required_for="all",
        prompt="Is this a new service request or a complaint about an existing service?",
    ),
    ClaimFieldDefinition(
        field="subType",
        label="Sub-Type",
        required_for="all",
        prompt="Can you be more specific about the issue?",
    ),
    ClaimFieldDefinition(
        field="description",
        label="Description",
        required_for="all",
        prompt="Can you briefly describe what happened?",
    ),
]
