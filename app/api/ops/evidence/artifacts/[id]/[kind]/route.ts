import { env } from "cloudflare:workers";
import { getEvidenceById, getStoredEvidence, verifyEvidenceArtifactToken } from "../../../../../../lib/evidence.ts";

export async function GET(request: Request, context: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind: rawKind } = await context.params;
  if (rawKind !== "source" && rawKind !== "screenshot") return Response.json({ error: "Unknown evidence artifact." }, { status: 404 });
  const kind: "source" | "screenshot" = rawKind;
  const url = new URL(request.url);
  const expiresAt = Number(url.searchParams.get("expires") ?? "0");
  const valid = await verifyEvidenceArtifactToken(id, kind, expiresAt, url.searchParams.get("token") ?? "", env);
  if (!valid) return Response.json({ error: "This evidence link is invalid or expired." }, { status: 401 });
  const evidence = await getEvidenceById(id, env);
  const storageKey = kind === "source" ? evidence?.html_storage_key : evidence?.screenshot_storage_key;
  if (!storageKey) return Response.json({ error: "That evidence artifact is unavailable." }, { status: 404 });
  const object = await getStoredEvidence(storageKey, env);
  if (!object) return Response.json({ error: "That evidence artifact could not be found." }, { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "private, no-store");
  headers.set("content-disposition", `attachment; filename="lotsocial-evidence-${id}.${kind === "source" ? (evidence?.content_type.includes("json") ? "json" : "html") : "png"}"`);
  return new Response(object.body, { headers });
}
