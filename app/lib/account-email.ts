import type { AccountAccessEmail } from "./account-auth.ts";
import type { LotSocialEnvironment } from "./schema-bootstrap.ts";

export async function sendAccountAccessEmail(access: AccountAccessEmail, env: LotSocialEnvironment) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return false;
  const expectedHost = env.LOTSOCIAL_EXPECTED_SITES_HOSTNAME?.trim().toLowerCase();
  if (!expectedHost || !/^[a-z0-9.-]+(?::\d+)?$/.test(expectedHost)) return false;
  const path = access.kind === "verification" ? `/verify/${access.token}` : `/login/${access.token}`;
  const magicUrl = new URL(path, `https://${expectedHost}`).toString();
  const verifying = access.kind === "verification";
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [access.email],
        subject: verifying ? "Verify your email to create your LotSocial account" : "Your secure LotSocial sign-in link",
        text: verifying
          ? `Hi ${access.displayName},\n\nVerify your work email and create your LotSocial account: ${magicUrl}\n\nThis single-use link expires in 20 minutes. If you did not request it, ignore this email.`
          : `Hi ${access.displayName},\n\nSign in to LotSocial: ${magicUrl}\n\nThis single-use link expires in 20 minutes. If you did not request it, ignore this email.`,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
