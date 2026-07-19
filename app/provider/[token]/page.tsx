import { ProviderForm } from "./ProviderForm";

export const dynamic = "force-dynamic";

export default async function ProviderPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <ProviderForm token={token} />;
}
