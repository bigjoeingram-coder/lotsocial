import { env } from "cloudflare:workers";
import { PERMISSIONS, PermissionId, evaluateAuthorization, getAuthorizationById } from "../../../lib/authorization";

function secureEqual(left: string, right: string) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}

export async function POST(request: Request) {
  const configuredKey = (env as unknown as { ENFORCEMENT_API_KEY?: string }).ENFORCEMENT_API_KEY;
  if (!configuredKey) return Response.json({ error: "Enforcement API is not configured." }, { status: 503 });

  const suppliedKey = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secureEqual(configuredKey, suppliedKey)) return Response.json({ error: "Unauthorized." }, { status: 401 });

  const payload = (await request.json()) as Record<string, unknown>;
  const authorizationId = typeof payload.authorizationId === "string" ? payload.authorizationId.trim() : "";
  const permission = typeof payload.permission === "string" && PERMISSIONS.some((item) => item.id === payload.permission)
    ? payload.permission as PermissionId
    : null;
  if (!authorizationId || !permission) return Response.json({ error: "A valid authorizationId and permission are required." }, { status: 400 });

  const record = await getAuthorizationById(authorizationId);
  const decision = evaluateAuthorization(record, permission);
  return Response.json({
    authorizationId,
    permission,
    ...decision,
    status: record?.status ?? "not_found",
    expiresAt: record?.expires_at ?? null,
    checkedAt: new Date().toISOString(),
  });
}
