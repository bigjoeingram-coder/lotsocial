import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../../chatgpt-auth";
import { handleVdpImportDelete } from "../../../lib/vdp-imports-handler.ts";

export async function DELETE(request: Request) {
  try {
    const associate = await requireAssociate(request, env);
    return handleVdpImportDelete(request, env, { associate });
  } catch (error) {
    return associateAuthResponse(error);
  }
}
