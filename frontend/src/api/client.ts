import type {
  ClaimDraft,
  ComplaintDetails,
  ComplaintRecord,
  Customer,
  ExtractedClaim,
  PegaCase,
  ValidationResult,
} from "../types/claim";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:3001/api";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status = 0) {
    super(message);
    this.status = status;
  }
}

// The login token lives in sessionStorage: it survives a page refresh but
// ends when the tab is closed, so the Customer ID is kept for the session.
const TOKEN_KEY = "globalnet_session_token";

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Non-fatal: the user will just need to sign in again after a refresh.
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const token = getToken();
  return token ? { ...extra, Authorization: `Bearer ${token}` } : extra;
}

async function handle<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => null);
  if (res.status === 401 && getToken()) {
    setToken(null);
    onUnauthorized?.();
  }
  if (!res.ok || !body?.success) {
    throw new ApiError(body?.error || "Something went wrong. Please try again.", res.status);
  }
  return body as T;
}

const JSON_HEADERS = { "Content-Type": "application/json" };

// ---- Auth ----

export async function registerCustomer(input: {
  name: string;
  email: string;
  phone: string;
  password: string;
}): Promise<{ customer: Customer }> {
  const res = await fetch(`${API_BASE}/auth/register`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(input),
  });
  return handle(res);
}

export async function loginCustomer(email: string, password: string): Promise<{ customer: Customer }> {
  const res = await fetch(`${API_BASE}/auth/login`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ email, password }),
  });
  const body = await handle<{ token: string; customer: Customer }>(res);
  setToken(body.token);
  return { customer: body.customer };
}

export async function fetchCurrentCustomer(): Promise<Customer | null> {
  if (!getToken()) return null;
  try {
    const res = await fetch(`${API_BASE}/auth/me`, { headers: authHeaders() });
    const body = await handle<{ customer: Customer }>(res);
    return body.customer;
  } catch {
    return null;
  }
}

export async function logoutCustomer(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: authHeaders() });
  } finally {
    setToken(null);
  }
}

// ---- Claims ----

export async function transcribeAudio(blob: Blob): Promise<{ transcript: string }> {
  const form = new FormData();
  form.append("audio", blob, "recording.webm");
  const res = await fetch(`${API_BASE}/claims/transcribe`, { method: "POST", headers: authHeaders(), body: form });
  return handle(res);
}

export async function extractClaim(
  transcript: string
): Promise<{ extracted: ExtractedClaim; validation: ValidationResult }> {
  const res = await fetch(`${API_BASE}/claims/extract`, {
    method: "POST",
    headers: authHeaders(JSON_HEADERS),
    body: JSON.stringify({ transcript }),
  });
  return handle(res);
}

export async function revalidateClaim(claim: ExtractedClaim): Promise<{ validation: ValidationResult }> {
  const res = await fetch(`${API_BASE}/claims/validate`, {
    method: "POST",
    headers: authHeaders(JSON_HEADERS),
    body: JSON.stringify(claim),
  });
  return handle(res);
}

export async function createClaimCase(draft: ClaimDraft): Promise<{ case: PegaCase }> {
  const res = await fetch(`${API_BASE}/claims`, {
    method: "POST",
    headers: authHeaders(JSON_HEADERS),
    body: JSON.stringify(draft),
  });
  return handle(res);
}

// ---- My Complaints ----

export async function listMyComplaints(fresh = false): Promise<ComplaintRecord[]> {
  const res = await fetch(`${API_BASE}/complaints${fresh ? "?fresh=true" : ""}`, { headers: authHeaders() });
  const body = await handle<{ complaints: ComplaintRecord[] }>(res);
  return body.complaints;
}

export async function getComplaintDetails(caseId: string): Promise<ComplaintDetails> {
  const res = await fetch(`${API_BASE}/complaints/${encodeURIComponent(caseId)}`, { headers: authHeaders() });
  const body = await handle<{ complaint: ComplaintDetails }>(res);
  return body.complaint;
}
