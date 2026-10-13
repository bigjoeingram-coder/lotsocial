import { env } from "cloudflare:workers";
import { handlePostingTick } from "../../../../lib/posting-tick-handler.ts";

export async function POST(request: Request) {
  return handlePostingTick(request, env);
}
