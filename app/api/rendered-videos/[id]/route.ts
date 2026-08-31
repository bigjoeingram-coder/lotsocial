import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../../chatgpt-auth";
import { getRenderJob } from "../../../lib/creative";
import { getStoredVideo } from "../../../lib/media";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireAssociate(request, env);
  } catch (error) {
    return associateAuthResponse(error);
  }
  const { id } = await context.params;
  const job = await getRenderJob(id, user.email, env);
  if (!job?.storage_key) return Response.json({ error: "That video is not available in permanent storage." }, { status: 404 });
  const object = await getStoredVideo(job.storage_key, env);
  if (!object) return Response.json({ error: "The stored video could not be found." }, { status: 404 });

  const url = new URL(request.url);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  headers.set("content-disposition", `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="lotsocial-${id}.mp4"`);
  return new Response(object.body, { headers });
}
