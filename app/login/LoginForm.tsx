"use client";

import { FormEvent, useState } from "react";

export function LoginForm({ invalidLink }: { invalidLink: boolean }) {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState(invalidLink ? "That sign-in link is invalid or expired. Request a fresh one." : "");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setMessage("");
    try {
      const response = await fetch("/api/account-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const payload = await response.json() as { message?: string; error?: string };
      setMessage(payload.message ?? payload.error ?? "Unable to request a sign-in link.");
    } catch {
      setMessage("LotSocial could not request a sign-in link. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return <form className="account-form" onSubmit={submit}>
    <label><span>Work email</span><input type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@dealership.com" required /></label>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Sending secure link..." : "Email me a secure sign-in link"}</button>
    {message && <p className="account-message" role="status">{message}</p>}
  </form>;
}
