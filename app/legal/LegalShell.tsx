import type { ReactNode } from "react";
import Link from "next/link";
import type { LegalDocument } from "./generated-content";
import { LEGAL_VERSIONS } from "./generated-content";

export const legalLinks = [
  { href: "/legal", label: "Legal center" },
  { href: "/legal/terms", label: "Terms" },
  { href: "/legal/privacy", label: "Privacy" },
  { href: "/legal/accuracy", label: "Accuracy" },
  { href: "/legal/fraud-awareness", label: "Fraud awareness" },
  { href: "/legal/authorization", label: "Authorization" },
  { href: "/legal/report", label: "Report a listing" },
] as const;

export function LegalShell({ document, children }: { document: LegalDocument; children: ReactNode }) {
  return <main className="legal-page">
    <header className="legal-masthead">
      <Link className="brand" href="/" aria-label="LotSocial home">
        <span className="brand-mark" aria-hidden="true">L</span>
        <span>LotSocial</span>
      </Link>
      <Link className="legal-report-link" href="/legal/report">Report a listing</Link>
    </header>

    <nav className="legal-topnav" aria-label="Legal pages">
      {legalLinks.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
    </nav>

    <div className="legal-frame">
      <aside className="legal-sidebar" aria-label="Legal center navigation">
        <p>Legal center</p>
        {legalLinks.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
      </aside>

      <article className="legal-document">
        <div className="legal-heading">
          <p className="eyebrow">LotSocial legal</p>
          <h1>{document.title}</h1>
          <p className="legal-dek">{document.summary}</p>
          <div className="legal-meta">
            <span>Updated {document.updated}</span>
            <strong>{document.versionLabel}</strong>
          </div>
          <dl className="legal-version-readback">
            <div><dt>Terms version</dt><dd>{LEGAL_VERSIONS.termsVersion}</dd></div>
            <div><dt>Disclaimer version</dt><dd>{LEGAL_VERSIONS.disclaimerVersion}</dd></div>
          </dl>
        </div>
        <div className="legal-review-note" role="note">
          <strong>Pilot legal version</strong>
          <p>This published v0.9 governs the current LotSocial pilot while counsel review remains pending. A later counsel-reviewed version will replace it through an explicit version update.</p>
        </div>
        <div className="legal-copy">{children}</div>
      </article>
    </div>
  </main>;
}
