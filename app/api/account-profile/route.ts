import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../chatgpt-auth.ts";
import { updateAccountProfile } from "../../lib/account-auth.ts";

export async function PATCH(request: Request) {
  try {
    const user = await requireAssociate(request, env);
    const body = await request.json() as { phone?: string; profilePhotoUrl?: string };
    await updateAccountProfile(user.email, body, env);
    return Response.json({ ok: true });
  } catch (error) {
    try {
      return associateAuthResponse(error);
    } catch {
      return Response.json({ error: error instanceof Error ? error.message : "Unable to update the account profile." }, { status: 400 });
    }
  }
}
