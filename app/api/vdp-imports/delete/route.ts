import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { handleVdpImportDelete } from "../../../lib/vdp-imports-handler.ts";

export async function DELETE(request: Request) {
  return handleVdpImportDelete(request, env, { getUser: getChatGPTUser });
}
