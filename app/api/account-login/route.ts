import { env } from "cloudflare:workers";
import { createAccountLoginLink } from "../../lib/account-auth.ts";

const GENERIC_MESSAGE = "If that work email has an active LotSocial account, a secure sign-in link is on the way.";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string };
  const link = await createAccountLoginLink(body.email ?? "", env);
  if (link && env.RESEND_API_KEY && env.EMAIL_FROM) {
    const loginUrl = new URL(`/login/${link.token}`, request.url).toString();
    try {
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: env.EMAIL_FROM,
          to: [link.email],
          subject: "Your secure LotSocial sign-in link",
          text: `Hi ${link.displayName},\n\nSign in to LotSocial: ${loginUrl}\n\nThis single-use link expires in 20 minutes.`,
        }),
      });
    } catch {
      // Keep the public response generic so account existence and delivery failures are not exposed.
    }
  }
  return Response.json({ message: GENERIC_MESSAGE });
}
