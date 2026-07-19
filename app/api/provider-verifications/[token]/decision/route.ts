import { decideProviderVerification } from "../../../../lib/authorization";

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const payload = (await request.json()) as Record<string, unknown>;
  const decision = payload.decision === "declined" ? "declined" : "verified";
  const input = {
    token,
    decision,
    providerName: clean(payload.providerName),
    contactName: clean(payload.contactName),
    contactEmail: clean(payload.contactEmail).toLowerCase(),
    deliveryMethod: clean(payload.deliveryMethod),
    feedFormat: clean(payload.feedFormat),
    connectionNotes: clean(payload.connectionNotes),
    typedSignature: clean(payload.typedSignature),
  } as const;
  if (decision === "verified" && (!input.providerName || !input.contactName || !input.contactEmail || !input.deliveryMethod || !input.feedFormat || !input.typedSignature || payload.confirmedAuthority !== true || payload.confirmedRights !== true)) {
    return Response.json({ error: "Verification requires provider details, delivery information, both confirmations, and a signature." }, { status: 400 });
  }
  const result = await decideProviderVerification(input);
  if (!result) return Response.json({ error: "This provider verification link is invalid." }, { status: 404 });
  if (result.alreadyDecided) return Response.json({ error: "This verification has already been completed.", status: result.verification.status }, { status: 409 });
  return Response.json({ status: result.verification.status });
}
