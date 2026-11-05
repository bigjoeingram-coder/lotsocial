import { LEGAL_DOCUMENTS } from "../generated-content";
import { LegalDocument } from "../LegalDocument";
import { LegalShell } from "../LegalShell";

const document = LEGAL_DOCUMENTS.authorization;
export const metadata = { title: `${document.title} | LotSocial`, description: document.summary, alternates: { canonical: document.route } };
export default function AuthorizationLegalPage() { return <LegalShell document={document}><LegalDocument document={document} /></LegalShell>; }
