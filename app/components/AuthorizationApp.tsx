"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { PERMISSIONS, PermissionId } from "../lib/authorization-shared";

type User = { name: string; email: string } | null;

type RequestRow = {
  id: string;
  dealership_name: string;
  rooftop_location: string;
  manager_name: string;
  manager_email: string;
  provider_name: string;
  requested_permissions: string;
  approved_permissions: string | null;
  status: string;
  email_delivery_status: string;
  requested_at: string;
  decided_at: string | null;
  expires_at: string | null;
};

type FormState = {
  dealershipName: string;
  rooftopLocation: string;
  dealershipDomain: string;
  associateName: string;
  associateEmail: string;
  managerName: string;
  managerTitle: string;
  managerEmail: string;
  managerPhone: string;
  providerName: string;
  providerContactName: string;
  providerContactEmail: string;
  requestedPermissions: PermissionId[];
};

const providers = [
  "Unknown / manager will confirm",
  "DealerOn",
  "Dealer Inspire / Cars Commerce",
  "Dealer.com",
  "Dealer Alchemist",
  "Jazel",
  "HomeNet",
  "vAuto",
  "Dealer Specialties",
  "Other",
];

const statusLabels: Record<string, string> = {
  requested: "Awaiting manager",
  manager_approved: "Manager approved",
  provider_pending: "Provider pending",
  feed_connected: "Feed connected",
  active: "Active",
  declined: "Declined",
  revoked: "Revoked",
  suspended: "Paused by manager",
  expired: "Expired",
};

function statusTone(status: string) {
  if (["active", "feed_connected", "manager_approved"].includes(status)) return "success";
  if (["declined", "revoked", "expired", "suspended"].includes(status)) return "danger";
  return "pending";
}

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")));
}

function initialForm(user: User): FormState {
  return {
    dealershipName: "",
    rooftopLocation: "",
    dealershipDomain: "",
    associateName: user?.name ?? "",
    associateEmail: user?.email ?? "",
    managerName: "",
    managerTitle: "Inventory Manager",
    managerEmail: "",
    managerPhone: "",
    providerName: "Unknown / manager will confirm",
    providerContactName: "",
    providerContactEmail: "",
    requestedPermissions: PERMISSIONS.map((permission) => permission.id),
  };
}

export function AuthorizationApp({ user }: { user: User }) {
  const [view, setView] = useState<"dashboard" | "request">("dashboard");
  const [step, setStep] = useState(1);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(() => initialForm(user));
  const [result, setResult] = useState<{ approvalUrl: string; emailDeliveryStatus: string; emailPreview?: string } | null>(null);

  async function loadRequests() {
    try {
      const response = await fetch("/api/authorization-requests", { cache: "no-store" });
      const payload = await response.json() as { requests?: RequestRow[] };
      setRequests(payload.requests ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadRequests(); }, []);

  const stats = useMemo(() => ({
    total: requests.length,
    waiting: requests.filter((request) => request.status === "requested").length,
    approved: requests.filter((request) => ["manager_approved", "provider_pending", "feed_connected", "active"].includes(request.status)).length,
    active: requests.filter((request) => request.status === "active").length,
  }), [requests]);

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function togglePermission(id: PermissionId) {
    update("requestedPermissions", form.requestedPermissions.includes(id)
      ? form.requestedPermissions.filter((permission) => permission !== id)
      : [...form.requestedPermissions, id]);
  }

  function nextStep() {
    setError("");
    if (step === 1 && (!form.dealershipName || !form.rooftopLocation || !form.associateName || !form.associateEmail)) {
      setError("Complete the dealership and associate details before continuing.");
      return;
    }
    if (step === 2 && (!form.managerName || !form.managerTitle || !form.managerEmail)) {
      setError("Add the approving manager’s name, title, and email before continuing.");
      return;
    }
    setStep((current) => Math.min(3, current + 1));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/authorization-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, providerName: form.providerName.replace("Unknown / manager will confirm", "Unknown") }),
      });
      const payload = await response.json() as { error?: string; approvalUrl?: string; emailDeliveryStatus?: string; emailPreview?: string };
      if (!response.ok || !payload.approvalUrl || !payload.emailDeliveryStatus) throw new Error(payload.error ?? "Unable to create the request.");
      setResult({ approvalUrl: payload.approvalUrl, emailDeliveryStatus: payload.emailDeliveryStatus, emailPreview: payload.emailPreview });
      await loadRequests();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to create the request.");
    } finally {
      setSubmitting(false);
    }
  }

  function startNewRequest() {
    setView("request");
    setStep(1);
    setResult(null);
    setError("");
    setForm(initialForm(user));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("dashboard")} aria-label="LotSocial home">
          <span className="brand-mark">L</span>
          <span>LotSocial</span>
        </button>
        <div className="topbar-actions">
          {!user && <a className="signin-link" href="/signin-with-chatgpt?return_to=%2F">Associate sign in</a>}
          <span className="environment-chip"><span className="live-dot" /> Authorization workspace</span>
          <div className="avatar" title={user?.email ?? "Demo associate"}>{(user?.name ?? "DA").slice(0, 2).toUpperCase()}</div>
        </div>
      </header>

      <main className="main-shell">
        {view === "dashboard" ? (
          <>
            <section className="hero-row">
              <div>
                <p className="eyebrow">Inventory permissions</p>
                <h1>Turn dealer approval into a clean, usable feed.</h1>
                <p className="hero-copy">Request the right data, document who approved it, and keep publishing disabled until every permission is in place.</p>
              </div>
              <button className="primary-button" onClick={startNewRequest}><span>＋</span> New authorization request</button>
            </section>

            {!user && (
              <div className="notice-card">
                <span className="notice-icon">i</span>
                <div><strong>Prototype mode</strong><p>Requests are saved, and manager links work. Connect an email provider before live sending.</p></div>
              </div>
            )}

            <section className="stat-grid" aria-label="Authorization summary">
              <article className="stat-card"><span className="stat-label">Total requests</span><strong>{stats.total}</strong><span className="stat-detail">Across all rooftops</span></article>
              <article className="stat-card"><span className="stat-label">Waiting on manager</span><strong>{stats.waiting}</strong><span className="stat-detail">Secure links outstanding</span></article>
              <article className="stat-card"><span className="stat-label">Manager approved</span><strong>{stats.approved}</strong><span className="stat-detail">Ready for provider review</span></article>
              <article className="stat-card accent-stat"><span className="stat-label">Active feeds</span><strong>{stats.active}</strong><span className="stat-detail">Authorized and connected</span></article>
            </section>

            <section className="panel request-panel">
              <div className="panel-header">
                <div><p className="eyebrow">Authorization ledger</p><h2>Recent requests</h2></div>
                <button className="text-button" onClick={() => void loadRequests()}>Refresh</button>
              </div>
              {loading ? (
                <div className="empty-state"><span className="loader" /><p>Loading authorization records…</p></div>
              ) : requests.length === 0 ? (
                <div className="empty-state"><div className="empty-icon">✓</div><h3>No requests yet</h3><p>Start with one dealership and send its inventory manager a scoped approval request.</p><button className="secondary-button" onClick={startNewRequest}>Create the first request</button></div>
              ) : (
                <div className="request-list">
                  {requests.map((request) => (
                    <article className="request-row" key={request.id}>
                      <div className="dealer-monogram">{request.dealership_name.slice(0, 2).toUpperCase()}</div>
                      <div className="request-primary"><strong>{request.dealership_name}</strong><span>{request.rooftop_location}</span></div>
                      <div className="request-meta"><span>Approver</span><strong>{request.manager_name}</strong><small>{request.manager_email}</small></div>
                      <div className="request-meta"><span>Provider</span><strong>{request.provider_name || "Unknown"}</strong><small>Requested {formatDate(request.requested_at)}</small></div>
                      <div className={`status-badge ${statusTone(request.status)}`}><span />{statusLabels[request.status] ?? request.status}</div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : (
          <section className="request-flow">
            <button className="back-button" onClick={() => setView("dashboard")}>← Back to authorizations</button>
            <div className="flow-layout">
              <aside className="flow-aside">
                <p className="eyebrow">New request</p>
                <h1>Ask once.<br />Document everything.</h1>
                <p>The manager controls the final scope. Inventory stays disabled until approval and provider access are confirmed.</p>
                <ol className="step-list">
                  {["Dealership", "Approver & provider", "Permission scope"].map((label, index) => (
                    <li key={label} className={step === index + 1 ? "current" : step > index + 1 ? "complete" : ""}>
                      <span>{step > index + 1 ? "✓" : index + 1}</span><div><strong>{label}</strong><small>{index === 0 ? "Who is requesting" : index === 1 ? "Who can authorize" : "Exactly what is allowed"}</small></div>
                    </li>
                  ))}
                </ol>
                <div className="aside-lock"><span>⌁</span><p><strong>Activation lock</strong><br />Approval unlocks provider review—not website scraping.</p></div>
              </aside>

              <div className="flow-card">
                {result ? (
                  <div className="success-state">
                    <div className="success-mark">✓</div>
                    <p className="eyebrow">Request created</p>
                    <h2>{result.emailDeliveryStatus === "sent" ? "The manager invitation is on its way." : "The manager invitation is ready."}</h2>
                    <p>{result.emailDeliveryStatus === "sent" ? "We sent the secure approval link and recorded the delivery event." : "Email delivery is in preview mode. Use the secure link below to test the manager experience."}</p>
                    <label className="link-preview"><span>Secure manager link</span><div><code>{result.approvalUrl}</code><button onClick={() => void navigator.clipboard.writeText(result.approvalUrl)}>Copy</button></div></label>
                    {result.emailPreview && <details className="email-preview"><summary>Preview manager email</summary><pre>{result.emailPreview}</pre></details>}
                    <div className="success-actions"><a className="primary-button" href={result.approvalUrl}>Open manager view</a><button className="secondary-button" onClick={() => setView("dashboard")}>Return to dashboard</button></div>
                  </div>
                ) : (
                  <form onSubmit={submit}>
                    <div className="flow-card-header"><div><span className="step-kicker">Step {step} of 3</span><h2>{step === 1 ? "Dealership & associate" : step === 2 ? "Approver & feed provider" : "Requested permission scope"}</h2></div><span className="autosave-label">● Saved as you go</span></div>

                    {step === 1 && <div className="form-grid">
                      <Field label="Dealership name" required value={form.dealershipName} onChange={(value) => update("dealershipName", value)} placeholder="South Coast Toyota" />
                      <Field label="Rooftop location" required value={form.rooftopLocation} onChange={(value) => update("rooftopLocation", value)} placeholder="Costa Mesa, CA" />
                      <Field label="Dealership website" value={form.dealershipDomain} onChange={(value) => update("dealershipDomain", value)} placeholder="southcoasttoyota.com" full />
                      <div className="section-rule"><span>Requesting associate</span></div>
                      <Field label="Your name" required value={form.associateName} onChange={(value) => update("associateName", value)} placeholder="Jordan Lee" />
                      <Field label="Your dealership email" required type="email" value={form.associateEmail} onChange={(value) => update("associateEmail", value)} placeholder="jordan@dealer.com" />
                    </div>}

                    {step === 2 && <div className="form-grid">
                      <Field label="Manager name" required value={form.managerName} onChange={(value) => update("managerName", value)} placeholder="Alex Martinez" />
                      <Field label="Manager title" required value={form.managerTitle} onChange={(value) => update("managerTitle", value)} placeholder="Inventory Director" />
                      <Field label="Manager email" required type="email" value={form.managerEmail} onChange={(value) => update("managerEmail", value)} placeholder="alex@dealer.com" />
                      <Field label="Manager phone" value={form.managerPhone} onChange={(value) => update("managerPhone", value)} placeholder="(555) 555-0100" />
                      <div className="section-rule"><span>Inventory provider, if known</span></div>
                      <label className="field"><span>Website or feed company</span><select value={form.providerName} onChange={(event) => update("providerName", event.target.value)}>{providers.map((provider) => <option key={provider}>{provider}</option>)}</select></label>
                      <Field label="Provider contact name" value={form.providerContactName} onChange={(value) => update("providerContactName", value)} placeholder="Optional" />
                      <Field label="Provider contact email" type="email" value={form.providerContactEmail} onChange={(value) => update("providerContactEmail", value)} placeholder="feeds@provider.com" full />
                    </div>}

                    {step === 3 && <div className="scope-section">
                      <div className="scope-intro"><p>Request only what LotSocial needs. The manager can remove any item before signing.</p><button type="button" className="text-button" onClick={() => update("requestedPermissions", PERMISSIONS.map((permission) => permission.id))}>Select all</button></div>
                      <div className="permission-grid">
                        {PERMISSIONS.map((permission) => <label className={`permission-card ${form.requestedPermissions.includes(permission.id) ? "selected" : ""}`} key={permission.id}>
                          <input type="checkbox" checked={form.requestedPermissions.includes(permission.id)} onChange={() => togglePermission(permission.id)} />
                          <span className="custom-check">✓</span><div><strong>{permission.label}</strong><p>{permission.detail}</p></div>
                        </label>)}
                      </div>
                      <div className="compliance-note"><span>!</span><p><strong>Manager approval is one gate.</strong> Feed-provider rights are verified separately before an inventory connection becomes active.</p></div>
                    </div>}

                    {error && <div className="form-error" role="alert">{error}</div>}
                    <div className="flow-actions">
                      {step > 1 ? <button type="button" className="secondary-button" onClick={() => { setError(""); setStep(step - 1); }}>Back</button> : <span />}
                      {step < 3 ? <button type="button" className="primary-button" onClick={nextStep}>Continue →</button> : <button type="submit" className="primary-button" disabled={submitting || form.requestedPermissions.length === 0}>{submitting ? "Creating request…" : "Create & send request"}</button>}
                    </div>
                  </form>
                )}
              </div>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, required, type = "text", full = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; type?: string; full?: boolean;
}) {
  return <label className={`field ${full ? "field-full" : ""}`}><span>{label}{required && <em>Required</em>}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} /></label>;
}
