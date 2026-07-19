"use client";

import { FormEvent, useEffect, useState } from "react";
import { PERMISSIONS, PermissionId } from "../../lib/authorization-shared";

type ApprovalRequest = {
  dealershipName: string;
  rooftopLocation: string;
  associateName: string;
  managerName: string;
  managerTitle: string;
  managerEmail: string;
  providerName: string;
  providerContactName: string;
  providerContactEmail: string;
  requestedPermissions: PermissionId[];
  approvedPermissions: PermissionId[];
  status: string;
  requestedAt: string;
  expiresAt: string | null;
  managerNotes: string;
  termsVersion: string;
};

const manageableStatuses = ["manager_approved", "provider_pending", "feed_connected", "active", "suspended"];

export function ApprovalForm({ token }: { token: string }) {
  const [record, setRecord] = useState<ApprovalRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [permissions, setPermissions] = useState<PermissionId[]>([]);
  const [providerName, setProviderName] = useState("");
  const [providerContactName, setProviderContactName] = useState("");
  const [providerContactEmail, setProviderContactEmail] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [typedSignature, setTypedSignature] = useState("");
  const [confirmedAuthority, setConfirmedAuthority] = useState(false);
  const [confirmedRights, setConfirmedRights] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch(`/api/authorization-requests/${token}`, { cache: "no-store" });
        const payload = await response.json() as { request?: ApprovalRequest; error?: string };
        if (!response.ok || !payload.request) throw new Error(payload.error ?? "Unable to load this request.");
        setRecord(payload.request);
        setPermissions(payload.request.approvedPermissions.length > 0 ? payload.request.approvedPermissions : payload.request.requestedPermissions);
        setProviderName(payload.request.providerName === "Unknown" ? "" : payload.request.providerName);
        setProviderContactName(payload.request.providerContactName);
        setProviderContactEmail(payload.request.providerContactEmail);
        setExpiresAt(payload.request.expiresAt ?? "");
        setManagerNotes(payload.request.managerNotes ?? "");
      } catch (caught) {
        setLoadError(caught instanceof Error ? caught.message : "Unable to load this request.");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  function togglePermission(id: PermissionId) {
    setPermissions((current) => current.includes(id) ? current.filter((permission) => permission !== id) : [...current, id]);
  }

  async function submitDecision(requestedDecision: "approved" | "declined") {
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/authorization-requests/${token}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: requestedDecision,
          typedSignature,
          confirmedAuthority,
          confirmedRights,
          approvedPermissions: permissions,
          providerName,
          providerContactName,
          providerContactEmail,
          expiresAt,
          managerNotes,
        }),
      });
      const payload = await response.json() as { error?: string; status?: string };
      if (!response.ok || !payload.status) throw new Error(payload.error ?? "Unable to record this decision.");
      setRecord((current) => current ? { ...current, status: payload.status!, approvedPermissions: requestedDecision === "approved" ? permissions : [] } : current);
      setNotice(requestedDecision === "approved" ? "Authorization approved. This secure link is now your access-management link." : "");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to record this decision.");
    } finally {
      setSubmitting(false);
    }
  }

  async function manageAccess(action: "update" | "suspend" | "revoke") {
    if (action === "revoke" && !window.confirm(`Revoke all LotSocial access for ${record?.associateName}? This takes effect immediately in the authorization record.`)) return;
    if (action === "suspend" && !window.confirm(`Pause LotSocial access for ${record?.associateName}? You can restore it later from this link.`)) return;

    setSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/authorization-requests/${token}/management`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, approvedPermissions: permissions, expiresAt, managerNotes }),
      });
      const payload = await response.json() as { error?: string; status?: string; approvedPermissions?: PermissionId[] };
      if (!response.ok || !payload.status) throw new Error(payload.error ?? "Unable to change access.");
      setPermissions(payload.approvedPermissions ?? permissions);
      setRecord((current) => current ? { ...current, status: payload.status!, approvedPermissions: payload.approvedPermissions ?? current.approvedPermissions } : current);
      setNotice(action === "revoke" ? "Access revoked and recorded." : action === "suspend" ? "Access paused and recorded." : record?.status === "suspended" ? "Authorization restored with the selected permissions." : "Permission changes saved.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to change access.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <ApprovalShell><div className="approval-loading"><span className="loader" /><p>Verifying secure authorization link...</p></div></ApprovalShell>;
  if (loadError || !record) return <ApprovalShell><div className="approval-result"><div className="result-mark danger">!</div><h1>This link cannot be used.</h1><p>{loadError}</p></div></ApprovalShell>;

  if (record.status === "declined" || record.status === "revoked") {
    const revoked = record.status === "revoked";
    return <ApprovalShell><div className="approval-result"><div className="result-mark danger">×</div><p className="eyebrow">Authorization closed</p><h1>{revoked ? "Access has been revoked." : "Authorization declined."}</h1><p>{revoked ? `LotSocial no longer has permission to use inventory data for ${record.associateName}. The revocation is recorded in the audit history.` : "No inventory connection will be activated for this request."}</p><div className="result-reference"><span>Dealership</span><strong>{record.dealershipName}</strong><small>{record.rooftopLocation}</small></div></div></ApprovalShell>;
  }

  if (manageableStatuses.includes(record.status)) {
    const paused = record.status === "suspended";
    return <ApprovalShell>
      <div className="approval-heading"><p className="eyebrow">Manager access control</p><h1>{record.dealershipName}</h1><p>Review, limit, pause, or revoke {record.associateName}'s inventory-data privileges.</p></div>
      <div className="approval-layout">
        <main className="approval-card">
          <div className="approval-card-header"><div><span className={`secure-chip ${paused ? "paused" : ""}`}>{paused ? "Access paused" : "Authorization active"}</span><h2>Manage approved access</h2></div><small>Terms {record.termsVersion}</small></div>
          <form onSubmit={(event: FormEvent) => { event.preventDefault(); void manageAccess("update"); }}>
            <section className="approval-section"><div className="section-number">1</div><div className="approval-section-content"><h3>Allowed uses</h3><p>Changes become the controlling permission record as soon as you save.</p><div className="approval-permissions">{PERMISSIONS.filter((permission) => record.requestedPermissions.includes(permission.id)).map((permission) => <label key={permission.id} className={permissions.includes(permission.id) ? "selected" : ""}><input type="checkbox" checked={permissions.includes(permission.id)} onChange={() => togglePermission(permission.id)} /><span className="custom-check">✓</span><div><strong>{permission.label}</strong><p>{permission.detail}</p></div></label>)}</div></div></section>
            <section className="approval-section"><div className="section-number">2</div><div className="approval-section-content"><h3>Expiration and restrictions</h3><p>Set an end date or document why access was changed.</p><div className="form-grid compact"><label className="field"><span>Authorization expiration</span><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label className="field"><span>Manager notes</span><input value={managerNotes} onChange={(event) => setManagerNotes(event.target.value)} placeholder="Reason, restriction, or policy reference" /></label></div></div></section>
            {notice && <div className="management-notice" role="status">{notice}</div>}
            {error && <div className="form-error" role="alert">{error}</div>}
            <div className="decision-actions management-actions"><div><button type="button" className="decline-button" disabled={submitting || paused} onClick={() => void manageAccess("suspend")}>Pause access</button><button type="button" className="revoke-button" disabled={submitting} onClick={() => void manageAccess("revoke")}>Revoke permanently</button></div><button type="submit" className="primary-button" disabled={submitting || permissions.length === 0}>{submitting ? "Saving..." : paused ? "Restore selected access" : "Save permission changes"}</button></div>
          </form>
        </main>
        <aside className="approval-summary"><div className="summary-icon">LS</div><p className="eyebrow">Access holder</p><dl><div><dt>Associate</dt><dd>{record.associateName}</dd></div><div><dt>Dealership</dt><dd>{record.dealershipName}<small>{record.rooftopLocation}</small></dd></div><div><dt>Current status</dt><dd>{paused ? "Paused by manager" : "Authorized"}</dd></div><div><dt>Expiration</dt><dd>{expiresAt || "No expiration set"}</dd></div></dl><div className="summary-lock"><strong>Keep this link secure</strong><p>It is the manager's continuing control link. Every saved change is added to the audit history.</p></div></aside>
      </div>
    </ApprovalShell>;
  }

  return <ApprovalShell>
    <div className="approval-heading"><p className="eyebrow">Secure inventory authorization</p><h1>{record.dealershipName}</h1><p>{record.associateName} is requesting permission to connect approved inventory data to LotSocial.</p></div>
    <div className="approval-layout">
      <main className="approval-card">
        <div className="approval-card-header"><div><span className="secure-chip">✓ Secure request</span><h2>Review the requested uses</h2></div><small>Terms {record.termsVersion}</small></div>
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void submitDecision("approved"); }}>
          <section className="approval-section"><div className="section-number">1</div><div className="approval-section-content"><h3>Permission scope</h3><p>Uncheck anything you do not authorize. Your selections become the controlling record.</p><div className="approval-permissions">{PERMISSIONS.filter((permission) => record.requestedPermissions.includes(permission.id)).map((permission) => <label key={permission.id} className={permissions.includes(permission.id) ? "selected" : ""}><input type="checkbox" checked={permissions.includes(permission.id)} onChange={() => togglePermission(permission.id)} /><span className="custom-check">✓</span><div><strong>{permission.label}</strong><p>{permission.detail}</p></div></label>)}</div></div></section>
          <section className="approval-section"><div className="section-number">2</div><div className="approval-section-content"><h3>Confirm the inventory provider</h3><p>This helps LotSocial request an authorized feed instead of collecting from the public website.</p><div className="form-grid compact"><label className="field field-full"><span>Provider or feed company</span><input value={providerName} onChange={(event) => setProviderName(event.target.value)} placeholder="DealerOn, HomeNet, vAuto, other, or unknown" /></label><label className="field"><span>Provider contact</span><input value={providerContactName} onChange={(event) => setProviderContactName(event.target.value)} placeholder="Optional" /></label><label className="field"><span>Provider email</span><input type="email" value={providerContactEmail} onChange={(event) => setProviderContactEmail(event.target.value)} placeholder="feeds@provider.com" /></label><label className="field"><span>Authorization expiration</span><input type="date" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label className="field"><span>Notes or restrictions</span><input value={managerNotes} onChange={(event) => setManagerNotes(event.target.value)} placeholder="Optional restrictions" /></label></div></div></section>
          <section className="approval-section"><div className="section-number">3</div><div className="approval-section-content"><h3>Authority and signature</h3><p>Your approval covers dealership-controlled rights only. Provider and licensor rights are still verified separately.</p><label className="confirmation"><input type="checkbox" checked={confirmedAuthority} onChange={(event) => setConfirmedAuthority(event.target.checked)} /><span className="custom-check">✓</span><span>I am authorized to approve inventory-data use for this dealership.</span></label><label className="confirmation"><input type="checkbox" checked={confirmedRights} onChange={(event) => setConfirmedRights(event.target.checked)} /><span className="custom-check">✓</span><span>To my knowledge, the selected uses are within the dealership's rights, subject to provider verification.</span></label><label className="signature-field"><span>Type your full legal name</span><input value={typedSignature} onChange={(event) => setTypedSignature(event.target.value)} placeholder={record.managerName} /><small>Submitting records your signature, decision time, permission scope, and authorization terms.</small></label></div></section>
          {error && <div className="form-error" role="alert">{error}</div>}
          <div className="decision-actions"><button type="button" className="decline-button" disabled={submitting} onClick={() => void submitDecision("declined")}>Decline request</button><button type="submit" className="primary-button" disabled={submitting}>{submitting ? "Recording decision..." : "Approve selected permissions"}</button></div>
        </form>
      </main>
      <aside className="approval-summary"><div className="summary-icon">LS</div><p className="eyebrow">Request summary</p><dl><div><dt>Dealership</dt><dd>{record.dealershipName}<small>{record.rooftopLocation}</small></dd></div><div><dt>Requested by</dt><dd>{record.associateName}</dd></div><div><dt>Approver</dt><dd>{record.managerName}<small>{record.managerTitle}</small></dd></div><div><dt>Provider</dt><dd>{record.providerName || "To be confirmed"}</dd></div></dl><div className="summary-lock"><strong>Inventory remains locked</strong><p>Approval advances this request to provider review. It does not activate a scraper.</p></div></aside>
    </div>
  </ApprovalShell>;
}

function ApprovalShell({ children }: { children: React.ReactNode }) {
  return <div className="approval-shell"><header className="approval-topbar"><a href="/" className="brand"><span className="brand-mark">L</span><span>LotSocial</span></a><span>Inventory Authorization</span></header><div className="approval-content">{children}</div><footer className="approval-footer"><span>LotSocial authorization record</span><span>Permission can be limited, paused, expired, or revoked.</span></footer></div>;
}
