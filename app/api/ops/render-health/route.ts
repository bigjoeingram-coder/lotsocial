import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../../chatgpt-auth.ts";

export async function GET(request: Request) {
  try {
    await requireAssociate(request, env);
  } catch (caught) {
    return associateAuthResponse(caught);
  }
  return Response.json({
    version: "v78",
    proxyOriginConfigured: Boolean(env.LOTSOCIAL_RENDER_PROXY_ORIGIN?.trim()),
    proxySecretConfigured: Boolean(env.LOTSOCIAL_RENDER_PROXY_SECRET?.trim()),
  });
}
