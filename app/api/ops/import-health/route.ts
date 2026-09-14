import { env } from "cloudflare:workers";
import { handleImportHealth } from "../../../lib/telemetry";

export async function GET(request: Request) {
  return handleImportHealth(request, env);
}
