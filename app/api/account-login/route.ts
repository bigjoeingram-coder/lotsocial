import { env } from "cloudflare:workers";
import { createAccountLoginLink } from "../../lib/account-auth.ts";
import { sendAccountAccessEmail } from "../../lib/account-email.ts";

const GENERIC_MESSAGE = "If that work email has an active LotSocial account, a secure sign-in link is on the way.";

export async function POST(request: Request) {
  const body = await request.json() as { email?: string };
  const link = await createAccountLoginLink(body.email ?? "", env);
  if (link) {
    try {
      await sendAccountAccessEmail({ kind: "login", ...link }, env);
    } catch {
      // Keep the public response generic so account existence and delivery failures are not exposed.
    }
  }
  return Response.json({ message: GENERIC_MESSAGE });
}
