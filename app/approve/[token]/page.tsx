import { ApprovalForm } from "./ApprovalForm";

export const dynamic = "force-dynamic";

export default async function ApprovalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ApprovalForm token={token} />;
}
