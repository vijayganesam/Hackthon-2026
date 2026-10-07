import type { Customer } from "../types/claim";

interface Plan {
  name: string;
  price: string;
  period: string;
  featured?: boolean;
  rows: { label: string; value: string }[];
  cta: string;
}

const PLANS: Plan[] = [
  {
    name: "Connect",
    price: "₹299",
    period: "/ 28 days",
    rows: [
      { label: "Data", value: "2 GB/day" },
      { label: "Calls", value: "Unlimited" },
      { label: "SMS", value: "100/day" },
      { label: "5G", value: "Included" },
    ],
    cta: "Choose Connect",
  },
  {
    name: "Stream+",
    price: "₹599",
    period: "/ 28 days",
    featured: true,
    rows: [
      { label: "Data", value: "3 GB/day" },
      { label: "Calls", value: "Unlimited" },
      { label: "OTT pack", value: "3 apps" },
      { label: "Rollover", value: "Yes" },
    ],
    cta: "Choose Stream+",
  },
  {
    name: "Home Fibre 300",
    price: "₹999",
    period: "/ month",
    rows: [
      { label: "Speed", value: "300 Mbps" },
      { label: "Data", value: "3.3 TB FUP" },
      { label: "Router", value: "Wi-Fi 6" },
      { label: "Install", value: "Free" },
    ],
    cta: "Book install",
  },
];

interface Props {
  customer: Customer;
  onRaiseRequest: () => void;
  onMyComplaints: () => void;
}

export function HomeScreen({ customer, onRaiseRequest, onMyComplaints }: Props) {
  return (
    <div className="home-page">
      <section className="hero">
        <div className="hero-copy">
          <div className="hero-eyebrow">5G SA · BAND N78 · 3.5 GHZ</div>
          <h1>
            Full bars from the metro to
            <br />
            the <span className="accent">last mile.</span>
          </h1>
          <p className="hero-desc">
            Mobile, home fibre and business connectivity on one network. Switch plans, track usage
            and get help without waiting in a queue.
          </p>
          <div className="hero-actions">
            <a href="#plans" className="btn btn-cta">
              See plans
            </a>
            <button className="btn btn-outline" onClick={onRaiseRequest}>
              Raise a request
            </button>
            <button className="btn btn-outline" onClick={onMyComplaints}>
              My Complaints
            </button>
          </div>
        </div>

        <div className="account-card">
          <div className="account-row">
            <span>{customer.name} · {customer.customerId}</span>
            <span>Cycle 12 / 30</span>
          </div>
          <div className="account-usage">
            <span className="account-usage-value">54.2</span>
            <span className="account-usage-label">GB left</span>
          </div>
          <div className="usage-track">
            <div className="usage-fill" style={{ width: "74%" }} />
          </div>
          <div className="account-stats">
            <div>
              <div className="account-stat-label">Downlink</div>
              <div className="account-stat-value">812 Mbps</div>
            </div>
            <div>
              <div className="account-stat-label">Latency</div>
              <div className="account-stat-value">11 ms</div>
            </div>
            <div>
              <div className="account-stat-label">Cell</div>
              <div className="account-stat-value">CHN-4127</div>
            </div>
          </div>
        </div>
      </section>

      <section className="plans-section" id="plans">
        <div className="plans-eyebrow">Plans</div>
        <div className="plans-header">
          <h2>Pick a plan, change it any month</h2>
          <span className="plans-note">Prices include GST. Unused data rolls over for one cycle.</span>
        </div>

        <div className="plans-grid">
          {PLANS.map((plan) => (
            <div key={plan.name} className={`plan-card ${plan.featured ? "plan-card-featured" : ""}`}>
              {plan.featured && <span className="plan-badge">Most chosen</span>}
              <div className="plan-name">{plan.name}</div>
              <div className="plan-price">
                <span className="plan-price-value">{plan.price}</span>
                <span className="plan-price-period">{plan.period}</span>
              </div>
              <div className="plan-rows">
                {plan.rows.map((row) => (
                  <div key={row.label} className="plan-row">
                    <span className="plan-row-label">{row.label}</span>
                    <span className="plan-row-value">{row.value}</span>
                  </div>
                ))}
              </div>
              <button className={`btn ${plan.featured ? "btn-cta" : "btn-outline"}`}>{plan.cta}</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
