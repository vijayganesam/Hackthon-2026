import type { Customer } from "../types/claim";

interface Props {
  customer: Customer | null;
  onLogoClick: () => void;
  onPlansClick: () => void;
  onRaiseRequest: () => void;
  onMyComplaints: () => void;
  onLogout: () => void;
}

export function SiteHeader({ customer, onLogoClick, onPlansClick, onRaiseRequest, onMyComplaints, onLogout }: Props) {
  return (
    <header className="app-header">
      <div className="header-inner">
        <button className="app-logo" onClick={onLogoClick}>
          <span className="app-logo-bars" aria-hidden="true">
            <span style={{ height: "40%" }} />
            <span style={{ height: "65%" }} />
            <span style={{ height: "85%" }} />
            <span style={{ height: "100%" }} />
          </span>
          GlobalNet
        </button>
        {customer && (
          <>
            <nav className="nav-links">
              <a onClick={onPlansClick}>Dashboard</a>
              <a onClick={onMyComplaints}>My Complaints</a>
            </nav>
            <span className="customer-chip" title={customer.email}>
              {customer.name} · {customer.customerId}
            </span>
            <button className="btn btn-outline header-logout" onClick={onLogout}>
              Sign out
            </button>
            <button className="btn btn-cta header-cta" onClick={onRaiseRequest}>
              Raise a request
            </button>
          </>
        )}
      </div>
    </header>
  );
}
