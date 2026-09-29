import Link from "next/link";
import { LEGAL_DOCUMENTS } from "./generated-content";
import { LegalShell } from "./LegalShell";

const indexDocument = {
  id: "index",
  route: "/legal",
  title: "Legal Center",
  summary: "Clear rules for source-grounded vehicle content, safe use, authorization, and issue reporting.",
  versionLabel: LEGAL_DOCUMENTS.terms.versionLabel,
  reviewStatus: LEGAL_DOCUMENTS.terms.reviewStatus,
  updated: LEGAL_DOCUMENTS.terms.updated,
  body: "",
} as const;

export const metadata = {
  title: "Legal Center | LotSocial",
  description: indexDocument.summary,
  alternates: { canonical: "/legal" },
};

const cardIds = ["terms", "privacy", "accuracy", "fraud-awareness", "authorization", "report"] as const;

export default function LegalCenterPage() {
  return <LegalShell document={indexDocument}>
    <section>
      <h2>Start with the policy you need</h2>
      <p>LotSocial turns a public dealership vehicle page into draft social content. It does not replace the current dealership listing, independent verification, or the approvals required before publishing.</p>
    </section>
    <section className="legal-card-grid" aria-label="Legal topics">
      {cardIds.map((id) => {
        const document = LEGAL_DOCUMENTS[id];
        return <Link className="legal-card" href={document.route} key={document.route}>
          <span>{document.versionLabel}</span>
          <h2>{document.title}</h2>
          <p>{document.summary}</p>
          <strong>Read this page <span aria-hidden="true">→</span></strong>
        </Link>;
      })}
    </section>
    <section>
      <h2>One operating rule</h2>
      <p>When a social post and the dealership&apos;s current vehicle page disagree, pause the post and verify the fact with the dealership. A disclaimer does not excuse information known to be wrong.</p>
    </section>
  </LegalShell>;
}
