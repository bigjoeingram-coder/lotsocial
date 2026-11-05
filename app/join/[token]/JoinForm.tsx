"use client";

import { FormEvent, useEffect, useState } from "react";

type Invite = { mode: "shared" | "single"; email?: string; dealershipName?: string; dealershipDomain?: string; expiresAt?: string };

export function JoinForm({ token }: { token: string }) {
  const [invite, setInvite] = useState<Invite | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [dealershipName, setDealershipName] = useState("");
  const [dealershipDomain, setDealershipDomain] = useState("");
  const [rooftopLocation, setRooftopLocation] = useState("");
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void fetch(`/api/pilot-invites/${token}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as { invite?: Invite; error?: string };
        if (!response.ok || !payload.invite) throw new Error(payload.error ?? "This invitation is unavailable.");
        setInvite(payload.invite);
        setEmail(payload.invite.email ?? "");
        setDealershipName(payload.invite.dealershipName ?? "");
        setDealershipDomain(payload.invite.dealershipDomain ?? "");
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "This invitation is unavailable."))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invite) return;
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/pilot-invites/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName, email, phone, dealershipName, dealershipDomain, rooftopLocation }),
      });
      const payload = await response.json() as { message?: string; error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Unable to send the secure email.");
      setSubmitted(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to send the secure email.");
      setSubmitting(false);
    }
  }

  if (loading) return <p className="account-message">Verifying your secure invitation...</p>;
  if (!invite) return <p className="account-message error">{error}</p>;
  if (submitted) return <div className="account-message"><strong>Check your work email.</strong><p>Use the single-use secure link to verify the address and continue. No account or session exists until that link is opened.</p></div>;

  return <form className="account-form" onSubmit={submit}>
    {invite.mode === "single" && <div className="account-dealer"><strong>{invite.dealershipName}</strong><span>{invite.dealershipDomain}</span></div>}
    {invite.mode === "shared" && <p className="account-message">Use your dealership-domain work email. This private pilot link has limited seats and expires.</p>}
    <label><span>Your name</span><input autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required /></label>
    <label><span>Work email</span><input type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} readOnly={invite.mode === "single"} required /></label>
    <label><span>Mobile or dealership phone</span><input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="(555) 555-0100" required /></label>
    {invite.mode === "shared" && <>
      <label><span>Dealership name</span><input autoComplete="organization" value={dealershipName} onChange={(event) => setDealershipName(event.target.value)} placeholder="Example Motors" required /></label>
      <label><span>Dealership website</span><input inputMode="url" autoComplete="url" value={dealershipDomain} onChange={(event) => setDealershipDomain(event.target.value)} placeholder="examplemotors.com" required /></label>
    </>}
    <label><span>Dealership location</span><input autoComplete="organization" value={rooftopLocation} onChange={(event) => setRooftopLocation(event.target.value)} placeholder="Waconia, MN" required /></label>
    <p className="account-message">You can add a profile or dealership photo after verifying your email.</p>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Sending secure link..." : "Verify email and continue"}</button>
    {error && <p className="account-message error" role="alert">{error}</p>}
  </form>;
}
