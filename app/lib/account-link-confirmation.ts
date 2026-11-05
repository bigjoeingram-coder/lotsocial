export type AccountLinkKind = "verification" | "login";

export function accountLinkConfirmation(kind: AccountLinkKind) {
  const verifying = kind === "verification";
  const title = verifying ? "Verify your work email" : "Sign in to LotSocial";
  const description = verifying
    ? "Confirm below to create your LotSocial account."
    : "Confirm below to securely sign in to your LotSocial workspace.";
  const button = verifying ? "Verify and continue" : "Sign in and continue";

  return new Response(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow,noarchive" />
    <title>${title} | LotSocial</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #07111f; color: #f8fafc; }
      main { width: min(100%, 460px); padding: 32px; border: 1px solid #1e3a5f; border-radius: 24px; background: #0b1728; box-shadow: 0 24px 80px rgba(0,0,0,.35); }
      .brand { margin: 0 0 20px; color: #3b82f6; font-weight: 800; letter-spacing: .02em; }
      h1 { margin: 0; font-size: clamp(1.8rem, 6vw, 2.35rem); line-height: 1.08; }
      p { margin: 16px 0 28px; color: #cbd5e1; line-height: 1.6; }
      button { width: 100%; border: 0; border-radius: 14px; padding: 15px 18px; background: #1677ff; color: white; font: inherit; font-weight: 800; cursor: pointer; }
      button:hover { background: #0f65dc; }
      button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
      small { display: block; margin-top: 18px; color: #94a3b8; line-height: 1.45; }
    </style>
  </head>
  <body>
    <main>
      <div class="brand">LotSocial</div>
      <h1>${title}</h1>
      <p>${description}</p>
      <form method="post">
        <button type="submit">${button}</button>
      </form>
      <small>This extra confirmation prevents automated email-security scanners from using your one-time link.</small>
    </main>
  </body>
</html>`, {
    status: 200,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}
