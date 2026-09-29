import { JoinForm } from "./JoinForm";

export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="account-shell">
    <section className="account-card wide">
      <div className="account-brand"><span>L</span><strong>LotSocial</strong></div>
      <p className="eyebrow">Private LotSocial access</p>
      <h1>Create your workspace</h1>
      <p>Your work email must be verified before LotSocial creates an account. Your phone and dealership details become your profile defaults after verification.</p>
      <JoinForm token={token} />
      <small className="account-legal">By creating an account, you agree to the <a href="/terms">pilot terms</a> and <a href="/privacy">privacy policy</a>.</small>
    </section>
  </main>;
}
