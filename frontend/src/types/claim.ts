// Issue/Subtype taxonomy — must exactly match the picklist values
// configured on the live Pega case type (GNet-Telecom-Work-ServiceRequest),
// mirroring backend/app/schema.py's ISSUE_TAXONOMY. Verified against Pega's
// own case-creation view metadata, not guessed.
export const ISSUE_TAXONOMY = {
  "Service Request": ["New Connection", "Plan Upgrade", "Plan Change"],
  Complaint: [
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
} as const;

export type IssueType = keyof typeof ISSUE_TAXONOMY;
export const ISSUE_TYPES = Object.keys(ISSUE_TAXONOMY) as IssueType[];

export interface ExtractedClaim {
  issueType: IssueType | null;
  subType: string | null;
  description: string | null;
  confidence: Record<string, number> | null;
}

export interface ClaimDraft {
  issueType: IssueType;
  subType: string;
  description: string;
}

export interface MissingField {
  field: string;
  label: string;
  prompt: string;
}

export interface ValidationResult {
  isComplete: boolean;
  missingFields: MissingField[];
  issueType: IssueType | null;
}

export interface PegaCase {
  caseId: string;
  assignmentId: string | null;
}

export function claimToDraft(claim: ExtractedClaim): ClaimDraft {
  return {
    issueType: claim.issueType ?? "Complaint",
    subType: claim.subType ?? "",
    description: claim.description ?? "",
  };
}

export function draftToExtracted(draft: ClaimDraft): ExtractedClaim {
  return {
    issueType: draft.issueType,
    subType: draft.subType || null,
    description: draft.description || null,
    confidence: null,
  };
}

export interface Customer {
  customerId: string;
  name: string;
  email: string;
  phone: string;
}

// A complaint the customer has raised (a real Pega case was created).
export interface ComplaintRecord {
  caseId: string;
  assignmentId: string | null;
  customerId: string;
  issueType: IssueType;
  subType: string;
  description: string;
  // Case status from Pega (pyStatusWork), e.g. "In-Progress"; null if unknown.
  status: string | null;
  resolutionNotes?: string | null;
  actionItemsCompleted?: string | null;
  createdAt?: string;
}

// Latest state read from Pega; null when Pega couldn't be reached.
export interface LiveCaseInfo {
  status: string | null;
  stage: string | null;
  currentTask: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  issueType: string | null;
  subType: string | null;
  description: string | null;
  customerId: string | null;
}

export interface ComplaintDetails extends ComplaintRecord {
  live: LiveCaseInfo | null;
}
