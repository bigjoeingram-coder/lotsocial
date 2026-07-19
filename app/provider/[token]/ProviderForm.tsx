"use client";

import { FormEvent, useEffect, useState } from "react";
import { PERMISSIONS, PermissionId } from "../../lib/authorization-shared";

type Verification = {
  dealershipName: string;
  rooftopLocation: string;
  associateName: string;
  managerName: string;
  providerName: string;
  contactName: string;
  contactEmail: string;
  approvedPermissions: PermissionId[];
  deliveryMethod: string;
  feedFormat: string;
  connectionNotes: string;
  status: string;
};

export function ProviderForm({ token }: { token: string }) {
  const [record, setRecord] = useState<Verification | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [providerName, setProviderName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [deliveryMethod, setDeliveryMethod] = useState("");
  const [feedFormat, setFeedFormat] = useState("");
  const [connectionNotes, setConnectionNotes] = useState("");
  const [typedSignature, setTypedSignature] = useState("");
  const [confirmedAuthority, setConfirmedAuthority] = useState(false);
  const [confirmedRights, setConfirmedRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/provider-verifications/${token}`, { cache: "no-store" });
        const payload = await response.json() as { verification?: Verification; error?: string };
        if (!response.ok || !payload.verification) throw new Error(payload.error ?? "Unable to load provider verification.");
        setRecord(payload.verification);
        setProviderName(payload.verification.providerName);
        setContactName(payload.verification.contactName);
        setContactEmail(payload.verification.contactEmail);
        setDeliveryMethod(payload.verification.deliveryMethod);
        setFeedFormat(payload.verification.feedFormat);
        setConnectionNotes(payload.verification.connectionNotes);
      } catch (caught) {
        setLoadError(caught instanceof Error ? caught.message : "Unable to load provider verification.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  async function submit(decision: "verified" | "declined") {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/provider-verifications/${token}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, providerName, contactName, contactEmail, deliveryMethod, feedFormat, connectionNotes, typedSignature, confirmedAuthority, confirmedRights }),
      });
      const payload = await response.json() as { error?: string; status?: string };
      if (!response.ok || !payload.status) throw new Error(payload.error ?? "Unable to record provider verification.");
      setRecord((current) => current ? { ...current, status: payload.status! } : current);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record provider verification.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <ProviderShell><div className="approval-loading"><span className="loader" /><p>Verifying secure provider link...</p></div></ProviderShell>;
  if (loadError || !record) return <ProviderShell><div className="approval-result"><div className="result-mark danger">!</div><h1>This link cannot be used.</h1><p>{loadError}</p></div></ProviderShell>;
  if (record.status !== "pending") {
    const verified = record.status === "verified";
    return <ProviderShell><div className="approval-result"><div className={`result-mark ${verified ? "" : "danger"}`}>{verified ? "✓" : "×"}</div><p className="eyebrow">Provider response recorded</p><h1>{verified ? "Rights and delivery confirmed." : "Verification declined."}</h1><p>{verified ? "LotSocial can now begin technical feed validation. No credentials were collected here, and inventory remains blocked until the connection is tested and activated." : "The dealership authorization record has been updated. No inventory connection will be activated."}</p><div className="result-reference"><span>Dealership</span><strong>{record.dealershipName}</strong><small>{record.rooftopLocation}</small></div></div></ProviderShell>;
  }

  return <ProviderShell>
    <div className="approval-heading"><p className="eyebrow">Secure provider verification</p><h1>{record.dealershipName}</h1><p>Confirm that your organization can supply the manager-approved inventory data to LotSocial.</p></div>
    <div className="approval-layout">
      <main className="approval-card">
        <div className="approval-card-header"><div><span className="secure-chip">✓ No credentials requested</span><h2>Verify rights and delivery</h2></div><small>Provider onboarding</small></div>
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void submit("verified"); }}>
          <section className="approval-section"><div className="section-number">1</div><div className="approval-section-content"><h3>Approved data uses</h3><p>The dealership manager authorized only the uses below. Provider confirmation must not broaden this scope.</p><div className="provider-scope">{record.approvedPermissions.map((id) => { const permission = PERMISSIONS.find((item) => item.id === id); return permission ? <div key={id}><span>✓</span><div><strong>{permission.label}</strong><p>{permission.detail}</p></div></div> : null; })}</div></div></section>
          <section className="approval-section"><div className="section-number">2</div><div className="approval-section-content"><h3>Provider and feed details</h3><p>Describe the supported handoff. Do not enter passwords, private keys, or feed credentials.</p><div className="form-grid compact"><label className="field"><span>Provider company</span><input value={providerName} onChange={(event) => setProviderName(event.target.value)} required /></label><label className="field"><span>Authorized contact</span><input value={contactName} onChange={(event) => setContactName(event.target.value)} required /></label><label className="field field-full"><span>Business email</span><input type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} required /></label><label className="field"><span>Delivery method</span><select value={deliveryMethod} onChange={(event) => setDeliveryMethod(event.target.value)} required><option value="">Select method</option><option>SFTP push</option><option>REST API</option><option>Scheduled file export</option><option>Provider portal</option><option>Other secure handoff</option></select></label><label className="field"><span>Feed format</span><select value={feedFormat} onChange={(event) => setFeedFormat(event.target.value)} required><option value="">Select format</option><option>JSON</option><option>XML</option><option>CSV</option><option>Custom provider format</option></select></label><label className="field field-full"><span>Connection notes</span><input value={connectionNotes} onChange={(event) => setConnectionNotes(event.target.value)} placeholder="Endpoint owner, refresh schedule, setup contact, or restrictions" /></label></div></div></section>
          <section className="approval-section"><div className="section-number">3</div><div className="approval-section-content"><h3>Rights confirmation</h3><p>This verifies authority and delivery capability; it does not disclose or transfer credentials.</p><label className="confirmation"><input type="checkbox" checked={confirmedAuthority} onChange={(event) => setConfirmedAuthority(event.target.checked)} /><span className="custom-check">✓</span><span>I am authorized to confirm this provider's inventory-data delivery for the dealership shown.</span></label><label className="confirmation"><input type="checkbox" checked={confirmedRights} onChange={(event) => setConfirmedRights(event.target.checked)} /><span className="custom-check">✓</span><span>The provider can supply the approved data uses, subject to the stated format, method, and restrictions.</span></label><label className="signature-field"><span>Type your full legal name</span><input value={typedSignature} onChange={(event) => setTypedSignature(event.target.value)} placeholder={contactName} /><small>LotSocial records the signer, confirmation time, feed method, format, and authorization scope.</small></label></div></section>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="decision-actions"><button type="button" className="decline-button" disabled={submitting} onClick={() => void submit("declined")}>Cannot provide this feed</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "Recording..." : "Confirm rights & delivery"}</button></div>
        </form>
      </main>
      <aside className="approval-summary"><div className="summary-icon">LS</div><p className="eyebrow">Verification summary</p><dl><div><dt>Dealership</dt><dd>{record.dealershipName}<small>{record.rooftopLocation}</small></dd></div><div><dt>Associate</dt><dd>{record.associateName}</dd></div><div><dt>Manager approver</dt><dd>{record.managerName}</dd></div><div><dt>Provider</dt><dd>{providerName || "To be confirmed"}</dd></div></dl><div className="summary-lock"><strong>Technical activation remains locked</strong><p>After confirmation, LotSocial must test the feed and enforce the approved permission scope before publishing.</p></div></aside>
    </div>
  </ProviderShell>;
}

function ProviderShell({ children }: { children: React.ReactNode }) {
  return <div className="approval-shell"><header className="approval-topbar"><span className="brand"><span className="brand-mark">L</span><span>LotSocial</span></span><span>Provider Verification</span></header><div className="approval-content">{children}</div><footer className="approval-footer"><span>LotSocial provider-rights record</span><span>No feed credentials are collected on this page.</span></footer></div>;
}
