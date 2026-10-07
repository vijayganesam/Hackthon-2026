import { useState, type FormEvent } from "react";
import { ApiError, loginCustomer, registerCustomer } from "../api/client";
import type { Customer } from "../types/claim";

type Mode = "login" | "register";

interface Props {
  onAuthenticated: (customer: Customer) => void;
}

export function AuthScreen({ onAuthenticated }: Props) {
  const [mode, setMode] = useState<Mode>("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const switchMode = (next: Mode) => {
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword("");
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === "register") {
        const { customer } = await registerCustomer({ name, email, phone, password });
        // Registered — now sign in with the same details.
        setMode("login");
        setPassword("");
        setNotice(`Account created. Your Customer ID is ${customer.customerId}. Please sign in.`);
      } else {
        const { customer } = await loginCustomer(email, password);
        onAuthenticated(customer);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const isRegister = mode === "register";

  return (
    <div className="auth-page">
      <div className="auth-card card">
        <div className="auth-brand">
          <span className="app-logo-bars" aria-hidden="true">
            <span style={{ height: "40%" }} />
            <span style={{ height: "65%" }} />
            <span style={{ height: "85%" }} />
            <span style={{ height: "100%" }} />
          </span>
          GlobalNet
        </div>
        <div className="request-eyebrow">{isRegister ? "Create your account" : "Customer sign in"}</div>
        <h1>{isRegister ? "Register as a customer" : "Welcome back"}</h1>
        <p className="landing-sub">
          {isRegister
            ? "Tell us a few basic details. You'll get a unique Customer ID to track every request you raise."
            : "Sign in to raise a request and track your complaints."}
        </p>

        {notice && <div className="auth-notice">{notice}</div>}
        {error && <div className="top-error-banner"><span>{error}</span></div>}

        <form onSubmit={handleSubmit} className="auth-form" noValidate>
          {isRegister && (
            <>
              <div className="form-field">
                <label htmlFor="auth-name">Full name</label>
                <input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
              <div className="form-field">
                <label htmlFor="auth-phone">Phone number</label>
                <input
                  id="auth-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  autoComplete="tel"
                />
              </div>
            </>
          )}
          <div className="form-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="form-field">
            <label htmlFor="auth-password">Password</label>
            <input
              id="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
              placeholder={isRegister ? "At least 8 characters" : undefined}
            />
          </div>
          <button className="btn btn-cta auth-submit" type="submit" disabled={busy}>
            {busy ? "Please wait…" : isRegister ? "Create account" : "Sign in"}
          </button>
        </form>

        <div className="auth-switch">
          {isRegister ? "Already registered?" : "New to GlobalNet?"}{" "}
          <button className="btn-link" onClick={() => switchMode(isRegister ? "login" : "register")}>
            {isRegister ? "Sign in" : "Create an account"}
          </button>
        </div>
      </div>
    </div>
  );
}
