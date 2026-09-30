"use client";

import { FormEvent, useState } from "react";
import { accountLoginNotice, type AccountLoginNotice } from "../lib/account-login-notice.ts";

export function LoginForm({ invalidLink }: { invalidLink: boolean }) {
  const [email, setEmail] = useState("");
  const [notice, setNotice] = useState<AccountLoginNotice | null>(invalidLink
    ? accountLoginNotice(false, { error: "That sign-in link is invalid or expired. Request a fresh one." })
    : null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setNotice(null);
    try {
      const response = await fetch("/api/account-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }) });
      const payload = await response.json() as { message?: string; error?: string };
      setNotice(accountLoginNotice(response.ok, payload));
    } catch {
      setNotice(accountLoginNotice(false, { error: "LotSocial could not request a sign-in link. Try again." }));
    } finally {
      setSubmitting(false);
    }
  }

  return <form className="account-form" onSubmit={submit}>
    <label><span>Work email</span><input type="email" inputMode="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@dealership.com" required /></label>
    <button className="primary-button" type="submit" disabled={submitting}>{submitting ? "Sending secure link..." : "Email me a secure sign-in link"}</button>
    {notice && <p className={notice.className} role={notice.role}>{notice.message}</p>}
  </form>;
}
