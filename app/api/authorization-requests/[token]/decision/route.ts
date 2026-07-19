import { PERMISSIONS, PermissionId, decideAuthorization } from "../../../../lib/authorization";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const decision = payload.decision === "declined" ? "declined" : "approved";
  const approvedPermissions = Array.isArray(payload.approvedPermissions)
    ? payload.approvedPermissions.filter((item): item is PermissionId =>
        typeof item === "string" && PERMISSIONS.some((permission) => permission.id === item))
    : [];
  const typedSignature = clean(payload.typedSignature);

  if (decision === "approved" && (
    !typedSignature || payload.confirmedAuthority !== true || payload.confirmedRights !== true || approvedPermissions.length === 0
  )) {
    return Response.json({ error: "Approval requires a signature, both confirmations, and at least one permitted use." }, { status: 400 });
  }

  const result = await decideAuthorization({
    token,
    decision,
    typedSignature,
    approvedPermissions,
    providerName: clean(payload.providerName) || "Unknown",
    providerContactName: clean(payload.providerContactName),
    providerContactEmail: clean(payload.providerContactEmail).toLowerCase(),
    expiresAt: clean(payload.expiresAt) || null,
    managerNotes: clean(payload.managerNotes),
  });
  if (!result) return Response.json({ error: "This authorization link is invalid or has expired." }, { status: 404 });
  if (result.alreadyDecided) return Response.json({ error: "This request has already been decided.", status: result.record.status }, { status: 409 });
  return Response.json({ status: result.record.status });
}
