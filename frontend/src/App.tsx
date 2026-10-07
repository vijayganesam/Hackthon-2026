import { useEffect, useState } from "react";
import { useAudioRecorder } from "./hooks/useAudioRecorder";
import {
  transcribeAudio,
  extractClaim,
  createClaimCase,
  fetchCurrentCustomer,
  listMyComplaints,
  logoutCustomer,
  setUnauthorizedHandler,
  ApiError,
} from "./api/client";
import { claimToDraft, ISSUE_TAXONOMY, ISSUE_TYPES, type ClaimDraft, type Customer, type IssueType } from "./types/claim";
import { SiteHeader } from "./components/SiteHeader";
import { SiteFooter } from "./components/SiteFooter";
import { HomeScreen } from "./components/HomeScreen";
import { AuthScreen } from "./components/AuthScreen";
import {
  ComplaintsScreen,
  ComplaintDetailScreen,
  clearComplaintsCache,
  markComplaintsStale,
  prefetchComplaints,
} from "./components/ComplaintsScreen";
import { PegaAssignmentEmbed } from "./components/PegaAssignmentEmbed";
import "./index.css";

const pegaViewConfig = {
  scriptSrc: import.meta.env.VITE_PEGA_SCRIPT_SRC as string,
  pegaServerUrl: import.meta.env.VITE_PEGA_SERVER_URL as string,
  appAlias: import.meta.env.VITE_PEGA_APP_ALIAS as string,
  clientId: import.meta.env.VITE_PEGA_CLIENT_ID as string | undefined,
  authService: (import.meta.env.VITE_PEGA_AUTH_SERVICE as string | undefined) || "pega",
};

function isPegaViewConfigured(): boolean {
  return Boolean(pegaViewConfig.scriptSrc && pegaViewConfig.pegaServerUrl && pegaViewConfig.appAlias);
}

type View = "home" | "request" | "complaints" | "complaint-detail";
type PegaPhase = "idle" | "creating" | "submitted" | "error";

const EMPTY_DRAFT: ClaimDraft = {
  issueType: "Complaint",
  subType: "",
  description: "",
};

const EXAMPLE_PHRASES = [
  "I was charged twice this month",
  "No signal at home since yesterday",
  "I'd like to upgrade my plan",
  "My SIM is damaged",
];

function formatTime(total: number): string {
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function App() {
  const [view, setView] = useState<View>("home");
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const recorder = useAudioRecorder();

  // Restore the signed-in customer on refresh, and drop back to the sign-in
  // screen whenever the backend says the session is no longer valid.
  useEffect(() => {
    fetchCurrentCustomer().then((c) => {
      if (c) prefetchComplaints().catch(() => {});
      setCustomer(c);
      setAuthChecked(true);
    });
    setUnauthorizedHandler(() => setCustomer(null));
    return () => setUnauthorizedHandler(null);
  }, []);

  const [transcript, setTranscript] = useState("");
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [hasExtracted, setHasExtracted] = useState(false);

  const [draft, setDraft] = useState<ClaimDraft>(EMPTY_DRAFT);

  const [pegaPhase, setPegaPhase] = useState<PegaPhase>("idle");
  const [caseId, setCaseId] = useState<string | null>(null);
  // True once the assignment was submitted inside the Pega embed.
  const [assignmentDone, setAssignmentDone] = useState(false);
  // Case status read back from Pega for the new case (pyStatusWork).
  const [caseStatus, setCaseStatus] = useState<string | null>(null);
  const [assignmentId, setAssignmentId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const micWarning =
    recorder.status === "denied"
      ? "Microphone access was denied. Please allow microphone access and try again."
      : recorder.status === "unsupported"
      ? "Voice recording isn't supported in this browser. Please try Chrome or Edge."
      : null;

  const resetRequest = () => {
    setTranscript("");
    setIsTranscribing(false);
    setIsExtracting(false);
    setHasExtracted(false);
    setDraft(EMPTY_DRAFT);
    setPegaPhase("idle");
    setCaseId(null);
    setCaseStatus(null);
    setAssignmentDone(false);
    setAssignmentId(null);
    setErrorMessage(null);
    recorder.reset();
  };

  const goHome = () => {
    setView("home");
  };

  const goToComplaints = () => {
    setView("complaints");
  };

  const openComplaint = (caseId: string) => {
    setOpenCaseId(caseId);
    setView("complaint-detail");
  };

  const handleAuthenticated = (c: Customer) => {
    resetRequest();
    clearComplaintsCache();
    prefetchComplaints().catch(() => {});
    setView("home");
    setCustomer(c);
  };

  const handleLogout = async () => {
    await logoutCustomer();
    clearComplaintsCache();
    resetRequest();
    setView("home");
    setCustomer(null);
  };

  const goToRequest = () => {
    setView("request");
  };

  const runExtraction = async (text: string) => {
    if (!text.trim()) return;
    setIsExtracting(true);
    setErrorMessage(null);
    try {
      const { extracted } = await extractClaim(text);
      setDraft(claimToDraft(extracted));
      setHasExtracted(true);
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : "We couldn't understand your request.");
    } finally {
      setIsExtracting(false);
    }
  };

  const handleStart = async () => {
    setErrorMessage(null);
    await recorder.start();
  };

  const handleStop = async () => {
    const blob = await recorder.stop();
    if (!blob) {
      setErrorMessage("We couldn't capture any audio. Please try again.");
      return;
    }
    setIsTranscribing(true);
    try {
      const { transcript: text } = await transcribeAudio(blob);
      setTranscript(text);
      await runExtraction(text);
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : "We couldn't process your recording.");
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleChipClick = async (phrase: string) => {
    setTranscript(phrase);
    await runExtraction(phrase);
  };

  const handleIssueTypeChange = (issueType: IssueType) => {
    setDraft((d) => ({
      ...d,
      issueType,
      subType: (ISSUE_TAXONOMY[issueType] as readonly string[]).includes(d.subType) ? d.subType : "",
    }));
  };

  // "Edit" takes the user back to the transcript so they can correct what
  // was heard and re-run extraction, rather than a separate edit mode.
  const handleEditReview = () => {
    setHasExtracted(false);
  };

  // The "click Continue, create the case in Pega" moment. Only reached once
  // the user has confirmed the identified Issue + Sub-Type. The actual Pega
  // DX API call (OAuth + case creation) happens entirely on our backend —
  // the browser never sees the client secret.
  // Read the new case's status back from Pega for this customer. Pega can take
  // a moment to list a brand-new case in the data view, so retry a few times.
  const loadNewCaseStatus = async (newCaseId: string) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const rows = await listMyComplaints(true);
        const found = rows.find((c) => c.caseId === newCaseId);
        if (found?.status) {
          setCaseStatus(found.status);
          markComplaintsStale();
          prefetchComplaints().catch(() => {});
          return;
        }
      } catch {
        // Non-fatal — the status just won't show on this screen.
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }
  };

  const handleSubmitToPega = async () => {
    setCaseId(null);
    setCaseStatus(null);
    setAssignmentDone(false);
    setAssignmentId(null);
    setPegaPhase("creating");
    setErrorMessage(null);
    try {
      const { case: pegaCase } = await createClaimCase(draft);
      setCaseId(pegaCase.caseId);
      setAssignmentId(pegaCase.assignmentId);
      setPegaPhase("submitted");
      // Refresh the cached list so the new case appears in My Complaints.
      markComplaintsStale();
      void loadNewCaseStatus(pegaCase.caseId);
    } catch (err) {
      setErrorMessage(err instanceof ApiError ? err.message : "We couldn't create your complaint in Pega.");
      setPegaPhase("error");
    }
  };

  const isRecording = recorder.status === "recording";
  // Show the Pega assignment right after case creation, until it is submitted.
  const showAssignment = Boolean(assignmentId) && isPegaViewConfigured() && !assignmentDone;

  return (
    <div className="app-shell">
      <SiteHeader
        customer={customer}
        onLogoClick={goHome}
        onPlansClick={goHome}
        onRaiseRequest={goToRequest}
        onMyComplaints={goToComplaints}
        onLogout={handleLogout}
      />

      <main className="app-main">
        {authChecked && !customer && <AuthScreen onAuthenticated={handleAuthenticated} />}

        {customer && view === "home" && (
          <HomeScreen customer={customer} onRaiseRequest={goToRequest} onMyComplaints={goToComplaints} />
        )}

        {customer && view === "complaints" && (
          <ComplaintsScreen onRaiseRequest={goToRequest} onOpen={openComplaint} />
        )}

        {customer && view === "complaint-detail" && openCaseId && (
          <ComplaintDetailScreen caseId={openCaseId} onBack={goToComplaints} />
        )}

        {customer && view === "request" && (
          <div className="request-page">
            <button className="back-link" onClick={goHome}>
              ← Back to home
            </button>

            {errorMessage && (
              <div className="top-error-banner">
                <span>{errorMessage}</span>
                <button className="btn-link" onClick={() => setErrorMessage(null)}>
                  Dismiss
                </button>
              </div>
            )}

            {pegaPhase !== "submitted" && (
            <>
            {/* Voice intake hero */}
            <div className="request-hero">
              <div className="request-eyebrow">Raise a request</div>
              <h1>Tell us what you need</h1>
              <p className="landing-sub">
                Tap the mic and describe the problem in your own words. We'll turn it into a
                request and give you a reference number.
              </p>

              {!isRecording ? (
                <button className="mic-button-large" onClick={handleStart} aria-label="Start speaking" disabled={isTranscribing}>
                  <MicIcon />
                </button>
              ) : (
                <button className="mic-button-large mic-button-active" onClick={handleStop} aria-label="Stop recording">
                  <MicIcon />
                </button>
              )}

              {!isRecording ? (
                <>
                  <div className="mic-caption">Tap to speak</div>
                  <div className="waveform-dots" aria-hidden="true">
                    {Array.from({ length: 14 }).map((_, i) => (
                      <span key={i} />
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="request-waveform" aria-hidden="true">
                    {recorder.levels.map((v, i) => (
                      <span key={i} className="waveform-bar" style={{ height: `${8 + v * 48}px` }} />
                    ))}
                  </div>
                  <div className="recording-timer">
                    <span className="recording-dot" /> {formatTime(recorder.elapsedSeconds)}
                    <button className="btn btn-secondary" onClick={handleStop}>
                      Stop
                    </button>
                  </div>
                </>
              )}

              {micWarning && <p className="inline-warning">{micWarning}</p>}
            </div>

            <div className="heard-box">
              <div className="heard-label">What we heard</div>
              {isTranscribing ? (
                <div className="inline-loading">
                  <span className="spinner" /> Converting your speech to text...
                </div>
              ) : transcript ? (
                <>
                  <textarea
                    className="transcript-textarea"
                    value={transcript}
                    onChange={(e) => setTranscript(e.target.value)}
                    rows={3}
                  />
                  {isExtracting ? (
                    <div className="inline-loading">
                      <span className="spinner" /> Understanding your request...
                    </div>
                  ) : (
                    <div className="action-row action-row-left">
                      <button className="btn btn-secondary" disabled={!transcript.trim()} onClick={() => runExtraction(transcript)}>
                        Re-analyze with AI
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="heard-placeholder">Your words will appear here.</p>
              )}
            </div>

            {!isRecording && !hasExtracted && (
              <div className="chips-row">
                {EXAMPLE_PHRASES.map((phrase) => (
                  <button key={phrase} className="chip" onClick={() => handleChipClick(phrase)}>
                    "{phrase}"
                  </button>
                ))}
              </div>
            )}

            {!hasExtracted && (
              <p className="call-line">
                Prefer to call? <strong>1800 200 4117</strong> · toll-free, 24×7
              </p>
            )}

            {/* Review card: identified issue/sub-type/details, editable before confirming */}
            {hasExtracted && !isExtracting && (
              <section className="section-card card review-card">
                <div className="review-quote-label">
                  <span aria-hidden="true">🎙️</span> Your complaint
                </div>
                <p className="review-quote">"{transcript}"</p>

                <div className="form-field">
                  <label>Identified Issue</label>
                  <select value={draft.issueType} onChange={(e) => handleIssueTypeChange(e.target.value as IssueType)}>
                    {ISSUE_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>Sub-Type</label>
                  <select
                    value={draft.subType}
                    onChange={(e) => setDraft((d) => ({ ...d, subType: e.target.value }))}
                  >
                    <option value="" disabled>
                      Select a sub-type
                    </option>
                    {ISSUE_TAXONOMY[draft.issueType].map((sub) => (
                      <option key={sub} value={sub}>
                        {sub}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-field">
                  <label>Description</label>
                  <textarea
                    rows={3}
                    value={draft.description}
                    onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                  />
                </div>

                <div className="action-row">
                  <button className="btn btn-outline" onClick={handleEditReview} disabled={pegaPhase === "creating"}>
                    Edit
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleSubmitToPega}
                    disabled={!draft.subType.trim() || pegaPhase === "creating"}
                  >
                    {pegaPhase === "creating" ? "Creating your case…" : "Continue →"}
                  </button>
                </div>
              </section>
            )}

            </>
            )}

            {/* Case exists in Pega: open its assignment so the data can be checked there */}
            {pegaPhase === "submitted" && caseId && showAssignment && (
              <section className="section-card card pega-section">
                <div className="pega-assignment-head">
                  <div>
                    <div className="request-eyebrow">Case created in Pega</div>
                    <h2 className="pega-assignment-title">{caseId}</h2>
                    <p className="landing-sub">
                      Customer ID {customer?.customerId}
                      {caseStatus ? ` · Status ${caseStatus}` : ""}. Complete the request below.
                    </p>
                  </div>
                  <div className="pega-assignment-actions">
                    <button className="btn btn-outline" onClick={() => setAssignmentDone(true)}>
                      Skip to summary
                    </button>
                  </div>
                </div>
                <div className="pega-assignment-view">
                  <PegaAssignmentEmbed
                    scriptSrc={pegaViewConfig.scriptSrc}
                    pegaServerUrl={pegaViewConfig.pegaServerUrl}
                    appAlias={pegaViewConfig.appAlias}
                    assignmentID={assignmentId as string}
                    clientId={pegaViewConfig.clientId}
                    authService={pegaViewConfig.authService}
                    onAssignmentSubmit={() => setAssignmentDone(true)}
                    onScriptError={(message) => setErrorMessage(message)}
                  />
                </div>
              </section>
            )}

            {/* Final confirmation: after the Pega assignment is submitted, or when it can't be shown */}
            {pegaPhase === "submitted" && caseId && !showAssignment && (
              <section className="section-card card pega-section">
                <div className="success-inline">
                  <div className="success-check">✓</div>
                  <h2>Your request has been submitted successfully!</h2>
                  <p className="landing-sub">
                    Our team will begin processing your request. You'll receive updates as it
                    progresses.
                  </p>
                  <div className="confirm-summary">
                    <div className="confirm-row">
                      <span className="confirm-label">Customer ID</span>
                      <span className="confirm-value">{customer?.customerId}</span>
                    </div>
                    <div className="confirm-row">
                      <span className="confirm-label">Case Status</span>
                      <span className="confirm-value">{caseStatus ?? "Fetching from Pega…"}</span>
                    </div>
                    <div className="confirm-row">
                      <span className="confirm-label">Issue</span>
                      <span className="confirm-value">{draft.issueType}</span>
                    </div>
                    <div className="confirm-row">
                      <span className="confirm-label">Sub-Type</span>
                      <span className="confirm-value">{draft.subType}</span>
                    </div>
                    <div className="confirm-row">
                      <span className="confirm-label">Description</span>
                      <span className="confirm-value">{draft.description}</span>
                    </div>
                  </div>
                  <div className="case-id-card">
                    <div className="case-id-label">Reference Number</div>
                    <div className="case-id-value">{caseId}</div>
                  </div>
                  <button className="btn btn-secondary" onClick={resetRequest}>
                    Raise Another Request
                  </button>
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}

function MicIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
      <line x1="12" y1="19" x2="12" y2="23" />
      <line x1="8" y1="23" x2="16" y2="23" />
    </svg>
  );
}

export default App;
