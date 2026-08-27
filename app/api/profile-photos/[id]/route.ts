import { getStoredProfilePhoto } from "../../../lib/media";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const object = await getStoredProfilePhoto(id);
  if (!object) return Response.json({ error: "Profile photo not found." }, { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(object.body, { headers });
}
