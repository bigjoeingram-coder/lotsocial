import { LoginForm } from "./LoginForm";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const query = await searchParams;
  return <main className="account-shell">
    <section className="account-card">
      <div className="account-brand"><span>L</span><strong>LotSocial</strong></div>
      <p className="eyebrow">Customer pilot</p>
      <h1>Sign in to your workspace</h1>
      <p>Use the work email connected to your LotSocial account. No ChatGPT account is required.</p>
      <LoginForm invalidLink={query.error === "invalid_link"} />
      <aside className="account-note"><strong>New to LotSocial?</strong><span>Open the private signup link Joe sent you.</span></aside>
    </section>
  </main>;
}
