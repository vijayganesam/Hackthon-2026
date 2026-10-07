import { useEffect, useState } from "react";
import { ApiError, getComplaintDetails, listMyComplaints } from "../api/client";
import type { ComplaintDetails, ComplaintRecord, IssueType } from "../types/claim";

const ISSUE_ICON: Record<IssueType, string> = {
  "Service Request": "🔄",
  Complaint: "📋",
};

function statusClass(status: string | null | undefined): string {
  const s = (status ?? "").toLowerCase();
  if (s.startsWith("resolved")) return "status-badge status-resolved";
  if (s.includes("progress")) return "status-badge status-progress";
  return "status-badge";
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// Stale-while-revalidate cache: screens render instantly from the last known
// data, then refresh in the background. Cleared on sign in / sign out.
let listCache: ComplaintRecord[] | null = null;
let listFetchedAt = 0;
const LIST_FRESH_MS = 20_000;
let listInflight: Promise<ComplaintRecord[]> | null = null;
const detailCache = new Map<string, ComplaintDetails>();

export function clearComplaintsCache() {
  listCache = null;
  listFetchedAt = 0;
  listInflight = null;
  detailCache.clear();
}

// After a new complaint is raised: keep showing the old list while a fresh
// one loads, instead of dropping to a loading state.
export function markComplaintsStale() {
  listFetchedAt = 0;
  detailCache.clear();
}

// Fetch the list once at a time; also used to warm the cache before the
// customer opens My Complaints.
export function prefetchComplaints(): Promise<ComplaintRecord[]> {
  if (listCache && Date.now() - listFetchedAt < LIST_FRESH_MS) return Promise.resolve(listCache);
  if (!listInflight) {
    listInflight = listMyComplaints()
      .then((rows) => {
        listCache = rows;
        listFetchedAt = Date.now();
        return rows;
      })
      .finally(() => {
        listInflight = null;
      });
  }
  return listInflight;
}

interface ListProps {
  onRaiseRequest: () => void;
  onOpen: (caseId: string) => void;
}

export function ComplaintsScreen({ onRaiseRequest, onOpen }: ListProps) {
  const [complaints, setComplaints] = useState<ComplaintRecord[] | null>(listCache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    prefetchComplaints()
      .then((rows) => !cancelled && setComplaints(rows))
      .catch((err) => !cancelled && !listCache && setError(err instanceof ApiError ? err.message : "We couldn't load your complaints."));
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="home-page">
      <section className="complaints-section">
        <div className="complaints-header">
          <div>
            <div className="plans-eyebrow">My Complaints</div>
            <h2>Track what you've raised</h2>
          </div>
          <button className="btn btn-outline" onClick={onRaiseRequest}>
            Raise a request
          </button>
        </div>

        {error && (
          <div className="top-error-banner">
            <span>{error}</span>
          </div>
        )}

        {!error && complaints === null && <p className="landing-sub">Loading your complaints…</p>}

        {complaints && complaints.length === 0 && (
          <div className="complaints-empty">
            <span className="complaints-empty-icon" aria-hidden="true">
              🗂️
            </span>
            <p>No complaints raised yet.</p>
            <button className="btn btn-cta" onClick={onRaiseRequest}>
              Raise your first request
            </button>
          </div>
        )}

        {complaints && complaints.length > 0 && (
          <div className="complaints-grid">
            {complaints.map((c) => (
              <button key={c.caseId} className="complaint-card complaint-card-button" onClick={() => onOpen(c.caseId)}>
                <div className="complaint-card-top">
                  <span className="issue-badge">
                    <span aria-hidden="true">{ISSUE_ICON[c.issueType]}</span>
                    {c.issueType}
                  </span>
                  <span className={statusClass(c.status)}>{c.status ?? "Submitted"}</span>
                </div>
                <div className="complaint-subtype">{c.subType}</div>
                {c.description && <p className="complaint-desc">{c.description}</p>}
                <div className="complaint-meta">
                  <span>Ref {c.caseId}</span>
                  <span>View details →</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface DetailProps {
  caseId: string;
  onBack: () => void;
}

export function ComplaintDetailScreen({ caseId, onBack }: DetailProps) {
  // Show what the list already knows straight away; live stage/dates fill in
  // once Pega answers.
  const fromList = listCache?.find((c) => c.caseId === caseId);
  const [complaint, setComplaint] = useState<ComplaintDetails | null>(
    detailCache.get(caseId) ?? (fromList ? { ...fromList, live: null } : null)
  );
  const [loadingLive, setLoadingLive] = useState(!detailCache.has(caseId));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getComplaintDetails(caseId)
      .then((c) => {
        detailCache.set(caseId, c);
        if (!cancelled) setComplaint(c);
      })
      .catch((err) => !cancelled && !complaint && setError(err instanceof ApiError ? err.message : "We couldn't load this complaint."))
      .finally(() => !cancelled && setLoadingLive(false));
    return () => {
      cancelled = true;
    };
  }, [caseId]);

  const live = complaint?.live ?? null;
  // Case status comes from the Pega data view (pyStatusWork), falling back to
  // the live case lookup.
  const status = complaint?.status ?? live?.status ?? null;

  return (
    <div className="request-page">
      <button className="back-link" onClick={onBack}>
        ← Back to My Complaints
      </button>

      {error && (
        <div className="top-error-banner">
          <span>{error}</span>
        </div>
      )}

      {!error && !complaint && <p className="landing-sub">Loading complaint…</p>}

      {complaint && (
        <section className="section-card card">
          <div className="complaint-card-top">
            <div className="section-title" style={{ marginBottom: 0 }}>
              Complaint {complaint.caseId}
            </div>
            <span className={statusClass(status)}>{status ?? "Submitted"}</span>
          </div>

          <div className="confirm-summary" style={{ marginTop: "1rem" }}>
            <Row label="Case ID" value={complaint.caseId} />
            <Row label="Customer ID" value={complaint.customerId} />
            <Row label="Issue" value={complaint.issueType} />
            <Row label="Issue Subtype" value={complaint.subType} />
            <Row label="Description" value={complaint.description || "—"} />
            <Row label="Case Status" value={status ?? "—"} />
            <Row label="Current Stage" value={live?.stage ?? (loadingLive ? "Loading…" : "—")} />
            <Row label="Resolution Notes" value={complaint.resolutionNotes || "—"} />
            <Row label="Action Items Completed" value={complaint.actionItemsCompleted || "—"} />
            <Row label="Created" value={formatDate(live?.createdAt ?? complaint.createdAt)} />
            <Row label="Last Updated" value={live ? formatDate(live.updatedAt) : loadingLive ? "Loading…" : "—"} />
          </div>

          {!live && !loadingLive && (
            <p className="landing-sub" style={{ marginTop: "1rem" }}>
              Live status couldn't be loaded from Pega right now, so you're seeing what we recorded when you raised
              this request.
            </p>
          )}
        </section>
      )}
    </div>
  );
}

function Row({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`confirm-row ${wide ? "confirm-row-wide" : ""}`}>
      <span className="confirm-label">{label}</span>
      <span className="confirm-value">{value}</span>
    </div>
  );
}
