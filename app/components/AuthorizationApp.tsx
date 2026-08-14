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

type RequestDetail = {
  id: string;
  dealershipName: string;
  rooftopLocation: string;
  associateName: string;
  associateEmail: string;
  managerName: string;
  managerTitle: string;
  managerEmail: string;
  providerName: string;
  providerContactName: string;
  providerContactEmail: string;
  requestedPermissions: PermissionId[];
  approvedPermissions: PermissionId[];
  status: string;
  emailDeliveryStatus: string;
  requestedAt: string;
  decidedAt: string | null;
  expiresAt: string | null;
  managerNotes: string;
  effectiveAccess: { permission: PermissionId; allowed: boolean; reason: string }[];
  providerVerification: { status: string; deliveryMethod: string; feedFormat: string; connectionNotes: string; decidedAt: string | null } | null;
};

type AuditEvent = { id: number; actorType: string; actorEmail: string; action: string; createdAt: string };

type ImportedVehicle = {
  id: string;
  sourceUrl: string;
  sourceHost: string;
  title: string;
  vin: string;
  stockNumber: string;
  year: string;
  make: string;
  model: string;
  trim: string;
  price: string;
  currency: string;
  description: string;
  imageUrls: string[];
  facts: Record<string, string>;
  sourceType: string;
  certifiedAt: string;
  importedAt: string;
};

type CreativeProject = {
  id: string;
  vehicleId: string;
  selectedImages: string[];
  style: string;
  durationSeconds: number;
  voiceoverScript: string;
  socialCaption: string;
  endCardName: string;
  endCardPhone: string;
  endCardEmail: string;
  endCardCta: string;
  status: string;
  createdAt: string;
};

type RenderJob = {
  id: string;
  projectId: string;
  provider: string;
  providerRenderId: string;
  status: string;
  outputUrl: string;
  stored: boolean;
  errorMessage: string;
  summary: {
    format: string;
    durationSeconds: number;
    photoCount: number;
    endCardSeconds: number;
    style: string;
    fidelity: string;
  } | null;
  createdAt: string;
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

type ManualVehicleState = {
  year: string;
  make: string;
  model: string;
  trim: string;
  price: string;
  mileage: string;
  dealershipName: string;
};

const providers = [
  "Unknown / manager will confirm",
  "HomeNet",
  "vAuto",
  "DealerOn",
  "Dealer Inspire / Cars Commerce",
  "Dealer.com",
  "Dealer Alchemist",
  "Jazel",
  "Dealer Specialties",
  "Other",
];

const statusLabels: Record<string, string> = {
  requested: "Awaiting manager",
  manager_approved: "Manager approved",
  provider_pending: "Provider pending",
  provider_verified: "Provider verified",
  provider_declined: "Provider declined",
  feed_connected: "Feed connected",
  active: "Active",
  declined: "Declined",
  revoked: "Revoked",
  suspended: "Paused by manager",
  expired: "Expired",
};

function statusTone(status: string) {
  if (["active", "feed_connected", "manager_approved", "provider_verified"].includes(status)) return "success";
  if (["declined", "revoked", "expired", "suspended", "provider_declined"].includes(status)) return "danger";
  return "pending";
}

const renderStatusLabels: Record<string, string> = {
  queued: "Queued",
  fetching: "Collecting VDP photos",
  rendering: "Rendering video",
  saving: "Finalizing video",
  completed: "Video ready",
  failed: "Render failed",
  provider_error: "Renderer needs attention",
  awaiting_provider_setup: "Production plan ready",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(value.replace(" ", "T") + (value.includes("Z") ? "" : "Z")));
}

function formatPrice(value: string, currency: string) {
  const amount = Number(value.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(amount)) return value;
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD", maximumFractionDigits: 0 }).format(amount);
}

function vehicleDisplayName(vehicle: ImportedVehicle) {
  const structured = [vehicle.year, vehicle.make, vehicle.model, vehicle.trim].filter(Boolean);
  return vehicle.model ? structured.join(" ") : vehicle.title;
}

function vehicleModelLabel(vehicle: ImportedVehicle) {
  if (vehicle.model) return vehicle.model;
  let label = vehicle.title;
  for (const prefix of [vehicle.year, vehicle.make]) {
    if (prefix) label = label.replace(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "");
  }
  return label || vehicle.title;
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
  const [view, setView] = useState<"dashboard" | "request" | "inventory" | "creative">("dashboard");
  const [step, setStep] = useState(1);
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(() => initialForm(user));
  const [result, setResult] = useState<{ approvalUrl: string; emailDeliveryStatus: string; emailPreview?: string } | null>(null);
  const [detail, setDetail] = useState<{ request: RequestDetail; auditEvents: AuditEvent[] } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [providerDraft, setProviderDraft] = useState({ providerName: "", contactName: "", contactEmail: "" });
  const [providerInvite, setProviderInvite] = useState<{ providerUrl: string; emailDeliveryStatus: string; emailPreview?: string } | null>(null);
  const [vehicles, setVehicles] = useState<ImportedVehicle[]>([]);
  const [inventoryLoading, setInventoryLoading] = useState(true);
  const [vdpUrl, setVdpUrl] = useState("");
  const [authorizedToMarket, setAuthorizedToMarket] = useState(false);
  const [importingVdp, setImportingVdp] = useState(false);
  const [inventoryError, setInventoryError] = useState("");
  const [importNotice, setImportNotice] = useState("");
  const [manualVehicle, setManualVehicle] = useState<ManualVehicleState>({ year: "", make: "", model: "", trim: "", price: "", mileage: "", dealershipName: "" });
  const [installBannerHidden, setInstallBannerHidden] = useState(true);
  const [installHelp, setInstallHelp] = useState<"ios" | "android" | null>(null);
  const [creativeVehicle, setCreativeVehicle] = useState<ImportedVehicle | null>(null);
  const [selectedCreativeImages, setSelectedCreativeImages] = useState<string[]>([]);
  const [creativeStyle, setCreativeStyle] = useState("walkaround");
  const [creativeDuration, setCreativeDuration] = useState(30);
  const [endCardName, setEndCardName] = useState(user?.name ?? "");
  const [endCardPhone, setEndCardPhone] = useState("");
  const [endCardEmail, setEndCardEmail] = useState(user?.email ?? "");
  const [endCardCta, setEndCardCta] = useState("Message me for details");
  const [creativeDraft, setCreativeDraft] = useState<CreativeProject | null>(null);
  const [creativeError, setCreativeError] = useState("");
  const [generatingCreative, setGeneratingCreative] = useState(false);
  const [renderJob, setRenderJob] = useState<RenderJob | null>(null);
  const [preparingRender, setPreparingRender] = useState(false);

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

  async function loadVehicles() {
    try {
      const response = await fetch("/api/vdp-imports", { cache: "no-store" });
      const payload = await response.json() as { vehicles?: ImportedVehicle[] };
      setVehicles(payload.vehicles ?? []);
    } finally {
      setInventoryLoading(false);
    }
  }

  useEffect(() => { void loadVehicles(); }, []);

  useEffect(() => {
    setInstallBannerHidden(window.localStorage.getItem("lotsocial-install-banner-dismissed") === "yes");
  }, []);

  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  const isIos = /iPad|iPhone|iPod/i.test(userAgent);
  const isSafari = /^((?!chrome|android|crios|fxios).)*safari/i.test(userAgent);

  function dismissInstallBanner() {
    window.localStorage.setItem("lotsocial-install-banner-dismissed", "yes");
    setInstallBannerHidden(true);
  }

  async function importVdp(event: FormEvent) {
    event.preventDefault();
    setImportingVdp(true);
    setInventoryError("");
    setImportNotice("");
    try {
      const response = await fetch("/api/vdp-imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: vdpUrl, authorizedToMarket }),
      });
      const payload = await response.json() as { vehicle?: ImportedVehicle; error?: string };
      if (!response.ok || !payload.vehicle) throw new Error(payload.error ?? "Unable to import that VDP.");
      setVehicles((current) => [payload.vehicle!, ...current.filter((vehicle) => vehicle.id !== payload.vehicle!.id)]);
      setImportNotice(`${payload.vehicle.title} was added to My Inventory.`);
      setVdpUrl("");
      setAuthorizedToMarket(false);
      setManualVehicle({ year: "", make: "", model: "", trim: "", price: "", mileage: "", dealershipName: "" });
    } catch (caught) {
      setInventoryError(caught instanceof Error ? caught.message : "LotSocial could not scrape that VDP yet.");
    } finally {
      setImportingVdp(false);
    }
  }

  async function saveManualVehicle(event: FormEvent) {
    event.preventDefault();
    setImportingVdp(true);
    setInventoryError("");
    setImportNotice("");
    try {
      const response = await fetch("/api/vdp-imports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceUrl: vdpUrl, authorizedToMarket, manualVehicle }),
      });
      const payload = await response.json() as { vehicle?: ImportedVehicle; error?: string };
      if (!response.ok || !payload.vehicle) throw new Error(payload.error ?? "Unable to save that vehicle.");
      setVehicles((current) => [payload.vehicle!, ...current.filter((vehicle) => vehicle.id !== payload.vehicle!.id)]);
      setImportNotice(`${payload.vehicle.title} was added from manual details.`);
      setVdpUrl("");
      setAuthorizedToMarket(false);
      setManualVehicle({ year: "", make: "", model: "", trim: "", price: "", mileage: "", dealershipName: "" });
    } catch (caught) {
      setInventoryError(caught instanceof Error ? caught.message : "Unable to save that vehicle.");
    } finally {
      setImportingVdp(false);
    }
  }

  function startCreative(vehicle: ImportedVehicle) {
    setCreativeVehicle(vehicle);
    setSelectedCreativeImages(vehicle.imageUrls.slice(0, 6));
    setCreativeStyle("walkaround");
    setCreativeDuration(30);
    setCreativeDraft(null);
    setRenderJob(null);
    setCreativeError("");
    setView("creative");
  }

  function toggleCreativeImage(url: string) {
    setSelectedCreativeImages((current) => current.includes(url)
      ? current.filter((image) => image !== url)
      : current.length < 10 ? [...current, url] : current);
    setCreativeDraft(null);
  }

  async function generateCreative(event: FormEvent) {
    event.preventDefault();
    if (!creativeVehicle) return;
    setGeneratingCreative(true);
    setCreativeError("");
    try {
      const response = await fetch("/api/creative-projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vehicleId: creativeVehicle.id, selectedImages: selectedCreativeImages, style: creativeStyle, durationSeconds: creativeDuration, endCardName, endCardPhone, endCardEmail, endCardCta }),
      });
      const payload = await response.json() as { project?: CreativeProject; error?: string };
      if (!response.ok || !payload.project) throw new Error(payload.error ?? "Unable to create the storyboard.");
      setCreativeDraft(payload.project);
      setRenderJob(null);
    } catch (caught) {
      setCreativeError(caught instanceof Error ? caught.message : "Unable to create the storyboard.");
    } finally {
      setGeneratingCreative(false);
    }
  }

  async function prepareRender() {
    if (!creativeDraft) return;
    setPreparingRender(true);
    setCreativeError("");
    try {
      const response = await fetch(`/api/creative-projects/${creativeDraft.id}/render`, { method: "POST" });
      const payload = await response.json() as { job?: RenderJob; error?: string };
      if ((!response.ok && response.status !== 502) || !payload.job) throw new Error(payload.error ?? "Unable to prepare the production render.");
      setRenderJob(payload.job);
    } catch (caught) {
      setCreativeError(caught instanceof Error ? caught.message : "Unable to prepare the production render.");
    } finally {
      setPreparingRender(false);
    }
  }

  useEffect(() => {
    if (!creativeDraft || !renderJob || !["queued", "fetching", "rendering", "saving"].includes(renderJob.status)) return;
    let stopped = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/creative-projects/${creativeDraft.id}/render`, { cache: "no-store" });
        const payload = await response.json() as { job?: RenderJob };
        if (!stopped && response.ok && payload.job) setRenderJob(payload.job);
      } catch {
        // A later poll will retry while the current durable status remains visible.
      }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    void poll();
    return () => { stopped = true; window.clearInterval(timer); };
  }, [creativeDraft, renderJob?.id, renderJob?.status]);

  async function openDetails(id: string) {
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/authorization-details/${id}`, { cache: "no-store" });
      const payload = await response.json() as { request?: RequestDetail; auditEvents?: AuditEvent[]; error?: string };
      if (!response.ok || !payload.request) throw new Error(payload.error ?? "Unable to load authorization details.");
      setDetail({ request: payload.request, auditEvents: payload.auditEvents ?? [] });
      setProviderDraft({ providerName: payload.request.providerName === "Unknown" ? "" : payload.request.providerName, contactName: payload.request.providerContactName, contactEmail: payload.request.providerContactEmail });
      setProviderInvite(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load authorization details.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function inviteProvider() {
    if (!detail) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/authorization-details/${detail.request.id}/provider-invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(providerDraft),
      });
      const payload = await response.json() as { error?: string; providerUrl?: string; emailDeliveryStatus?: string; emailPreview?: string };
      if (!response.ok || !payload.providerUrl || !payload.emailDeliveryStatus) throw new Error(payload.error ?? "Unable to prepare provider verification.");
      setProviderInvite({ providerUrl: payload.providerUrl, emailDeliveryStatus: payload.emailDeliveryStatus, emailPreview: payload.emailPreview });
      setDetail((current) => current ? { ...current, request: { ...current.request, status: "provider_pending", providerName: providerDraft.providerName, providerContactName: providerDraft.contactName, providerContactEmail: providerDraft.contactEmail, providerVerification: { status: "pending", deliveryMethod: "", feedFormat: "", connectionNotes: "", decidedAt: null } } } : current);
      await loadRequests();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to prepare provider verification.");
    } finally {
      setSubmitting(false);
    }
  }

  const stats = useMemo(() => ({
    total: requests.length,
    waiting: requests.filter((request) => request.status === "requested").length,
    approved: requests.filter((request) => ["manager_approved", "provider_pending", "provider_verified", "feed_connected", "active"].includes(request.status)).length,
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
        <nav className="workspace-nav" aria-label="Workspace">
          <button className={["inventory", "creative"].includes(view) ? "active" : ""} onClick={() => setView("inventory")}>My Inventory</button>
          <button className={view !== "inventory" ? "active" : ""} onClick={() => setView("dashboard")}>Authorizations</button>
        </nav>
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
                    <button className="request-row" key={request.id} onClick={() => void openDetails(request.id)} disabled={detailLoading}>
                      <div className="dealer-monogram">{request.dealership_name.slice(0, 2).toUpperCase()}</div>
                      <div className="request-primary"><strong>{request.dealership_name}</strong><span>{request.rooftop_location}</span></div>
                      <div className="request-meta"><span>Approver</span><strong>{request.manager_name}</strong><small>{request.manager_email}</small></div>
                      <div className="request-meta"><span>Provider</span><strong>{request.provider_name || "Unknown"}</strong><small>Requested {formatDate(request.requested_at)}</small></div>
                      <div className={`status-badge ${statusTone(request.status)}`}><span />{statusLabels[request.status] ?? request.status}</div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : view === "request" ? (
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
        ) : view === "inventory" ? (
          <section className="inventory-workspace">
            {!installBannerHidden && <div className="install-banner">
              <div>
                <p className="eyebrow">Pilot setup</p>
                <h2>Add LotSocial to your home screen</h2>
                <p>Use it like an app during the salesperson test. Same secure web app, one tap from your phone.</p>
                {isIos && !isSafari && <small>On iPhone, open this page in Safari before adding it to your home screen.</small>}
              </div>
              <div className="install-actions">
                <button type="button" className={installHelp === "ios" ? "active" : ""} onClick={() => setInstallHelp(installHelp === "ios" ? null : "ios")}>iPhone</button>
                <button type="button" className={installHelp === "android" ? "active" : ""} onClick={() => setInstallHelp(installHelp === "android" ? null : "android")}>Android</button>
                <button type="button" className="install-dismiss" onClick={dismissInstallBanner} aria-label="Dismiss install instructions">Dismiss</button>
              </div>
              {installHelp === "ios" && <ol className="install-steps">
                <li>Tap the Share icon in Safari&apos;s toolbar.</li>
                <li>Scroll down and tap Add to Home Screen.</li>
                <li>Tap Add in the top right.</li>
              </ol>}
              {installHelp === "android" && <ol className="install-steps">
                <li>Tap the three-dot menu in Chrome.</li>
                <li>Tap Add to Home screen or Install app.</li>
                <li>Tap Add or Install to confirm.</li>
              </ol>}
            </div>}
            <div className="inventory-hero">
              <div><p className="eyebrow">Starter inventory</p><h1>Paste a VDP. Start creating.</h1><p>Import one public dealership vehicle page at a time. LotSocial captures the listed facts, available imagery, source URL, and import time.</p></div>
              <span className="plan-chip">Starter · VDP Scrape</span>
            </div>
            <form className="vdp-import-panel" onSubmit={importVdp}>
              <div className="vdp-import-heading"><div className="import-icon">↗</div><div><h2>Import a vehicle detail page</h2><p>Use the exact public VDP for the vehicle you want to promote.</p></div></div>
              <label className="vdp-url-field"><span>Vehicle detail page URL</span><div><input type="url" value={vdpUrl} onChange={(event) => setVdpUrl(event.target.value)} placeholder="https://dealer.com/inventory/vehicle..." required /><button className="primary-button" type="submit" disabled={importingVdp || !authorizedToMarket}>{importingVdp ? "Scraping VDP..." : "Import vehicle"}</button></div></label>
              <label className="vdp-certification"><input type="checkbox" checked={authorizedToMarket} onChange={(event) => setAuthorizedToMarket(event.target.checked)} /><span className="custom-check">✓</span><span>I certify that I am authorized to market this dealership's vehicle and use its approved VDP content for dealership social posts.</span></label>
              <div className="vdp-boundary"><strong>One-time, source-stamped import</strong><span>LotSocial does not bypass logins or access controls. Automated inventory remains a Pro feed feature.</span></div>
              {inventoryError && <div className="form-error" role="alert">{inventoryError}</div>}
              {importNotice && <div className="management-notice" role="status">{importNotice}</div>}
            </form>
            <section className="inventory-section">
              <div className="inventory-section-header"><div><p className="eyebrow">My inventory</p><h2>{vehicles.length} imported {vehicles.length === 1 ? "vehicle" : "vehicles"}</h2></div><div className="pro-callout"><span>PRO</span><p><strong>Want your entire lot here automatically?</strong><br />Connect HomeNet, vAuto, or an authorized dealership feed.</p><button onClick={() => setView("dashboard")}>Set up automation →</button></div></div>
              {inventoryLoading ? <div className="empty-state"><span className="loader" /><p>Loading your inventory...</p></div> : vehicles.length === 0 ? <div className="empty-state inventory-empty"><div className="empty-icon">VIN</div><h3>Your first vehicle starts with a URL</h3><p>Paste one of the dealership's public VDP links above. The extracted record remains tied to its original source.</p></div> : <div className="vehicle-grid">{vehicles.map((vehicle) => <article className="vehicle-card" key={vehicle.id}><div className="vehicle-image">{vehicle.imageUrls[0] ? <img src={vehicle.imageUrls[0]} alt={vehicle.title} loading="lazy" referrerPolicy="no-referrer" /> : <div className="vehicle-placeholder">No VDP image found</div>}<span className="source-badge">{vehicle.sourceHost}</span></div><div className="vehicle-body"><div className="vehicle-title"><div><span>{vehicle.year} {vehicle.make}</span><h3>{vehicleModelLabel(vehicle)}</h3><p>{vehicle.trim}</p></div>{vehicle.price && <strong>{formatPrice(vehicle.price, vehicle.currency)}</strong>}</div><dl><div><dt>VIN</dt><dd>{vehicle.vin || "Not detected"}</dd></div><div><dt>Stock</dt><dd>{vehicle.stockNumber || "Not detected"}</dd></div><div><dt>Photos</dt><dd>{vehicle.imageUrls.length}</dd></div></dl><div className="vehicle-source"><span>Captured {formatDate(vehicle.importedAt)}</span><a href={vehicle.sourceUrl} target="_blank" rel="noreferrer">View source ↗</a></div><button className="creative-next" onClick={() => startCreative(vehicle)}>{vehicle.imageUrls.length < 2 ? "Create social caption →" : "Create video storyboard →"}</button></div></article>)}</div>}
            </section>
          </section>
        ) : (
          <section className="creative-workspace">
            <button className="back-button" onClick={() => setView("inventory")}>← Back to My Inventory</button>
            {!creativeVehicle ? <div className="empty-state"><h3>Select a vehicle first</h3><p>Return to My Inventory and choose a vehicle with at least two VDP photos.</p></div> : <form onSubmit={generateCreative}>
              <div className="creative-heading"><div><p className="eyebrow">Creative studio</p><h1>{vehicleDisplayName(creativeVehicle)}</h1><p>Build a source-grounded vertical-video storyboard from the dealership's VDP photos and facts.</p></div><div className="creative-vehicle-chip">{creativeVehicle.price && <strong>{formatPrice(creativeVehicle.price, creativeVehicle.currency)}</strong>}<span>VIN {creativeVehicle.vin || "not detected"}</span></div></div>
              <div className="creative-layout">
                <main className="creative-editor">
                  <section className="creative-step"><div className="creative-step-title"><span>1</span><div><h2>{creativeVehicle.imageUrls.length ? "Select the shots" : "Caption-only draft"}</h2><p>{creativeVehicle.imageUrls.length ? "Choose 2–10 photos. Their order becomes the first storyboard sequence." : "The dealer page could not be read automatically, so LotSocial will create the social copy from your source-stamped manual details."}</p></div><strong>{selectedCreativeImages.length} selected</strong></div>{creativeVehicle.imageUrls.length ? <div className="creative-photo-grid">{creativeVehicle.imageUrls.map((image, index) => <button type="button" key={image} className={selectedCreativeImages.includes(image) ? "selected" : ""} onClick={() => toggleCreativeImage(image)}><img src={image} alt={`VDP photo ${index + 1}`} loading="lazy" referrerPolicy="no-referrer" /><span>{selectedCreativeImages.includes(image) ? selectedCreativeImages.indexOf(image) + 1 : "+"}</span></button>)}</div> : <div className="caption-only-note">You can generate, copy, and post the caption now. A video render needs at least two vehicle photos.</div>}</section>
                  <section className="creative-step"><div className="creative-step-title"><span>2</span><div><h2>Choose the pacing</h2><p>The script uses only facts captured from the source VDP.</p></div></div><div className="creative-options"><label className={creativeStyle === "energetic" ? "selected" : ""}><input type="radio" name="style" value="energetic" checked={creativeStyle === "energetic"} onChange={() => { setCreativeStyle("energetic"); setCreativeDraft(null); }} /><strong>Fast cuts</strong><p>Quick hooks and energetic pacing</p></label><label className={creativeStyle === "walkaround" ? "selected" : ""}><input type="radio" name="style" value="walkaround" checked={creativeStyle === "walkaround"} onChange={() => { setCreativeStyle("walkaround"); setCreativeDraft(null); }} /><strong>Walkaround</strong><p>Clear, conversational vehicle tour</p></label><label className={creativeStyle === "premium" ? "selected" : ""}><input type="radio" name="style" value="premium" checked={creativeStyle === "premium"} onChange={() => { setCreativeStyle("premium"); setCreativeDraft(null); }} /><strong>Premium</strong><p>Slower, polished presentation</p></label></div><div className="duration-options"><span>Target length</span>{[15,30,45].map((duration) => <button type="button" key={duration} className={creativeDuration === duration ? "active" : ""} onClick={() => { setCreativeDuration(duration); setCreativeDraft(null); }}>{duration}s</button>)}</div></section>
                  <section className="creative-step"><div className="creative-step-title"><span>3</span><div><h2>Salesperson end card</h2><p>This becomes the final shot and call to action.</p></div></div><div className="form-grid compact"><label className="field"><span>Display name</span><input value={endCardName} onChange={(event) => { setEndCardName(event.target.value); setCreativeDraft(null); }} required /></label><label className="field"><span>Phone</span><input value={endCardPhone} onChange={(event) => { setEndCardPhone(event.target.value); setCreativeDraft(null); }} placeholder="Optional" /></label><label className="field"><span>Email</span><input type="email" value={endCardEmail} onChange={(event) => { setEndCardEmail(event.target.value); setCreativeDraft(null); }} /></label><label className="field"><span>Call to action</span><select value={endCardCta} onChange={(event) => { setEndCardCta(event.target.value); setCreativeDraft(null); }}><option>Message me for details</option><option>Schedule your test drive</option><option>Ask me for today's availability</option><option>Contact me for current pricing</option></select></label></div></section>
                  {creativeError && <div className="form-error" role="alert">{creativeError}</div>}
                  <button className="primary-button creative-generate" type="submit" disabled={generatingCreative}>{generatingCreative ? "Building creative..." : creativeDraft ? "Regenerate creative draft" : selectedCreativeImages.length < 2 ? "Generate social caption" : "Generate creative draft"}</button>
                </main>
                <aside className="creative-preview"><div className="phone-preview"><div className="phone-screen">{selectedCreativeImages[0] ? <img src={selectedCreativeImages[0]} alt="First storyboard frame" referrerPolicy="no-referrer" /> : <div /> }<div className="preview-overlay"><span>{creativeStyle}</span><strong>{creativeVehicle.year} {creativeVehicle.make}<br />{creativeVehicle.model}</strong><small>{creativeVehicle.price ? `${formatPrice(creativeVehicle.price, creativeVehicle.currency)} as listed` : "Contact for pricing"}</small></div></div></div><div className="preview-sequence">{selectedCreativeImages.slice(0,6).map((image,index) => <div key={image}><img src={image} alt="" referrerPolicy="no-referrer" /><span>{index + 1}</span></div>)}<div className="end-frame"><strong>{endCardName || "Your name"}</strong><span>{endCardCta}</span></div></div><p className="preview-note">Storyboard preview · Final rendering will animate these shots and splice the end card.</p></aside>
              </div>
              {creativeDraft && <section className="creative-output"><div className="output-heading"><div><p className="eyebrow">{selectedCreativeImages.length < 2 ? "Caption ready" : "Storyboard ready"}</p><h2>Grounded copy and production brief</h2></div><span>Saved draft</span></div><div className="output-grid"><article><div><h3>Voiceover script</h3><button type="button" onClick={() => void navigator.clipboard.writeText(creativeDraft.voiceoverScript)}>Copy</button></div><p>{creativeDraft.voiceoverScript}</p></article><article><div><h3>Social caption</h3><button type="button" onClick={() => void navigator.clipboard.writeText(creativeDraft.socialCaption)}>Copy</button></div><pre>{creativeDraft.socialCaption}</pre></article></div><div className="render-gate"><div><span>Production render</span><strong>{selectedCreativeImages.length < 2 ? "Add two vehicle photos to render video." : "Prepare a source-faithful 9:16 video."}</strong><p>{selectedCreativeImages.length < 2 ? "The caption is ready to post now; video remains unavailable without source imagery." : "Original VDP photos, deterministic motion, exact listing copy, and the salesperson end card."}</p></div><button type="button" onClick={() => void prepareRender()} disabled={selectedCreativeImages.length < 2 || preparingRender || Boolean(renderJob && ["queued", "fetching", "rendering", "saving", "completed"].includes(renderJob.status))}>{selectedCreativeImages.length < 2 ? "Video needs 2 photos" : preparingRender ? "Preparing..." : renderJob?.status === "completed" ? "Video ready" : renderJob && ["queued", "fetching", "rendering", "saving"].includes(renderJob.status) ? "Rendering..." : renderJob?.status === "awaiting_provider_setup" ? "Check connection" : "Prepare vertical video"}</button></div>{renderJob && <div className={`render-result ${renderJob.status}`} role="status"><div><span className="render-status-dot" /><div><strong>{renderStatusLabels[renderJob.status] ?? "Render update"}</strong><p>{renderJob.status === "completed" ? renderJob.stored ? "Your source-faithful video is saved permanently and ready to download." : renderJob.errorMessage || "Your source-faithful vertical video is ready to review and download." : ["queued", "fetching", "rendering", "saving"].includes(renderJob.status) ? "This page checks progress automatically. You will not be charged for duplicate clicks." : renderJob.errorMessage}</p></div></div>{renderJob.summary && <dl><div><dt>Output</dt><dd>{renderJob.summary.format}</dd></div><div><dt>Length</dt><dd>{renderJob.summary.durationSeconds}s</dd></div><div><dt>Shots</dt><dd>{renderJob.summary.photoCount} + end card</dd></div><div><dt>Storage</dt><dd>{renderJob.stored ? "Saved permanently" : "Provider copy"}</dd></div></dl>}{renderJob.status === "completed" && renderJob.outputUrl && <div className="completed-video"><video controls playsInline preload="metadata" poster={selectedCreativeImages[0]}><source src={renderJob.outputUrl} type="video/mp4" />Your browser cannot preview this video.</video><div><strong>Final vertical video</strong><p>Review every vehicle detail before publishing.</p><a href={renderJob.stored ? `${renderJob.outputUrl}?download=1` : renderJob.outputUrl} target="_blank" rel="noreferrer">Download MP4 ↗</a></div></div>}</div>}</section>}
            </form>}
          </section>
        )}
      </main>
      {detail && <div className="detail-backdrop" role="presentation" onMouseDown={() => setDetail(null)}>
        <section className="detail-drawer" role="dialog" aria-modal="true" aria-label="Authorization details" onMouseDown={(event) => event.stopPropagation()}>
          <div className="detail-header"><div><p className="eyebrow">Authorization record</p><h2>{detail.request.dealershipName}</h2><p>{detail.request.rooftopLocation}</p></div><button className="detail-close" onClick={() => setDetail(null)} aria-label="Close details">×</button></div>
          <div className="detail-status"><div className={`status-badge ${statusTone(detail.request.status)}`}><span />{statusLabels[detail.request.status] ?? detail.request.status}</div><strong>{detail.request.status === "active" ? "Connector access is enabled" : "Connector access is blocked"}</strong><p>{detail.request.status === "active" ? "The connector may use only the permissions listed below." : "The enforcement gate will deny inventory use until this record reaches Active status."}</p></div>
          <div className="detail-grid"><div><span>Associate</span><strong>{detail.request.associateName}</strong><small>{detail.request.associateEmail}</small></div><div><span>Manager</span><strong>{detail.request.managerName}</strong><small>{detail.request.managerEmail}</small></div><div><span>Provider</span><strong>{detail.request.providerName || "Unknown"}</strong><small>{detail.request.providerContactEmail || "Contact not added"}</small></div><div><span>Expiration</span><strong>{detail.request.expiresAt || "No expiration"}</strong><small>Checked on every connector request</small></div></div>
          <section className="detail-section"><div className="detail-section-title"><h3>Approved permissions</h3><span>{detail.request.approvedPermissions.length}</span></div>{detail.request.approvedPermissions.length === 0 ? <p className="detail-empty">No permissions are currently approved.</p> : <div className="detail-permissions">{detail.request.approvedPermissions.map((id) => { const permission = PERMISSIONS.find((item) => item.id === id)!; const effective = detail.request.effectiveAccess.find((item) => item.permission === id); return <div key={id}><span className={effective?.allowed ? "permission-live" : "permission-blocked"}>{effective?.allowed ? "Allowed" : "Blocked"}</span><strong>{permission.label}</strong><p>{permission.detail}</p></div>; })}</div>}</section>
          {detail.request.managerNotes && <section className="detail-section"><h3>Manager restrictions</h3><p className="manager-note">{detail.request.managerNotes}</p></section>}
          {["manager_approved", "provider_pending", "provider_declined"].includes(detail.request.status) && <section className="detail-section provider-invite-card"><div className="detail-section-title"><h3>Provider verification</h3><span>Next</span></div><p>Send the feed company a secure rights-and-delivery confirmation. A new invitation replaces any older provider link.</p><div className="provider-invite-grid"><label><span>Provider company</span><input value={providerDraft.providerName} onChange={(event) => setProviderDraft((current) => ({ ...current, providerName: event.target.value }))} placeholder="HomeNet, DealerOn, vAuto..." /></label><label><span>Contact name</span><input value={providerDraft.contactName} onChange={(event) => setProviderDraft((current) => ({ ...current, contactName: event.target.value }))} placeholder="Feed operations contact" /></label><label className="provider-email"><span>Contact email</span><input type="email" value={providerDraft.contactEmail} onChange={(event) => setProviderDraft((current) => ({ ...current, contactEmail: event.target.value }))} placeholder="feeds@provider.com" /></label></div><button className="primary-button provider-invite-button" disabled={submitting} onClick={() => void inviteProvider()}>{submitting ? "Preparing..." : detail.request.status === "provider_pending" ? "Replace & resend verification" : "Create provider verification"}</button>{providerInvite && <div className="provider-invite-result"><strong>{providerInvite.emailDeliveryStatus === "sent" ? "Verification email sent" : "Verification link ready"}</strong><div><code>{providerInvite.providerUrl}</code><button onClick={() => void navigator.clipboard.writeText(providerInvite.providerUrl)}>Copy</button></div>{providerInvite.emailPreview && <details><summary>Preview email</summary><pre>{providerInvite.emailPreview}</pre></details>}</div>}</section>}
          {detail.request.status === "provider_verified" && detail.request.providerVerification && <section className="detail-section provider-verified-card"><div><span className="permission-live">Verified</span><h3>Provider rights confirmed</h3><p>{detail.request.providerVerification.deliveryMethod} · {detail.request.providerVerification.feedFormat}</p></div><p>{detail.request.providerVerification.connectionNotes || "No additional connection notes were supplied."}</p><small>Technical feed testing is the final gate before activation.</small></section>}
          <section className="detail-section"><div className="detail-section-title"><h3>Audit history</h3><span>{detail.auditEvents.length}</span></div><div className="audit-list">{detail.auditEvents.map((event) => <div className="audit-event" key={event.id}><span className="audit-dot" /><div><strong>{formatAuditAction(event.action)}</strong><p>{event.actorType} · {event.actorEmail || "system"}</p></div><time>{formatDate(event.createdAt)}</time></div>)}</div></section>
        </section>
      </div>}
    </div>
  );
}

function formatAuditAction(action: string) {
  const labels: Record<string, string> = {
    permission_requested: "Authorization requested",
    manager_approved: "Manager approved access",
    declined: "Manager declined access",
    manager_permissions_updated: "Permissions changed",
    manager_access_suspended: "Access paused",
    manager_access_resumed: "Access restored",
    manager_access_revoked: "Access revoked",
    provider_verification_invited: "Provider verification created",
    provider_invitation_prepared: "Provider invitation prepared",
    provider_rights_verified: "Provider rights verified",
    provider_verification_declined: "Provider verification declined",
  };
  return labels[action] ?? action.replaceAll("_", " ");
}

function Field({ label, value, onChange, placeholder, required, type = "text", full = false }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean; type?: string; full?: boolean;
}) {
  return <label className={`field ${full ? "field-full" : ""}`}><span>{label}{required && <em>Required</em>}</span><input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} /></label>;
}
