import { PERMISSIONS, PermissionId, manageAuthorization } from "../../../../lib/authorization";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const action = payload.action === "revoke" ? "revoke" : payload.action === "suspend" ? "suspend" : "update";
  const approvedPermissions = Array.isArray(payload.approvedPermissions)
    ? payload.approvedPermissions.filter((item): item is PermissionId =>
        typeof item === "string" && PERMISSIONS.some((permission) => permission.id === item))
    : [];

  if (action !== "revoke" && approvedPermissions.length === 0) {
    return Response.json({ error: "Keep at least one permission, or revoke access entirely." }, { status: 400 });
  }

  const result = await manageAuthorization({
    token,
    action,
    approvedPermissions,
    expiresAt: clean(payload.expiresAt) || null,
    managerNotes: clean(payload.managerNotes),
  });
  if (!result) return Response.json({ error: "This management link is invalid." }, { status: 404 });
  if (result.unavailable) return Response.json({ error: "This authorization can no longer be changed.", status: result.record.status }, { status: 409 });

  return Response.json({
    status: result.record.status,
    approvedPermissions: result.record.status === "revoked" ? [] : approvedPermissions,
  });
}
