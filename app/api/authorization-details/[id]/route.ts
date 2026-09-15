import { env } from "cloudflare:workers";
import { associateAuthResponse, requireAssociate } from "../../../chatgpt-auth";
import { evaluateAuthorization, getAuthorizationByIdForAssociate, getProviderVerification, listAuditEvents, parsePermissions } from "../../../lib/authorization";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  let user;
  try {
    user = await requireAssociate(_request, env);
  } catch (error) {
    return associateAuthResponse(error);
  }

  const { id } = await context.params;
  const record = await getAuthorizationByIdForAssociate(id, user.email, env);
  if (!record) return Response.json({ error: "Authorization record not found." }, { status: 404 });
  const auditEvents = await listAuditEvents(record.id, env);
  const providerVerification = await getProviderVerification(record.id, env);
  const approvedPermissions = parsePermissions(record.approved_permissions);

  return Response.json({
    request: {
      id: record.id,
      dealershipName: record.dealership_name,
      rooftopLocation: record.rooftop_location,
      dealershipDomain: record.dealership_domain,
      associateName: record.associate_name,
      associateEmail: record.associate_email,
      managerName: record.manager_name,
      managerTitle: record.manager_title,
      managerEmail: record.manager_email,
      providerName: record.provider_name,
      providerContactName: record.provider_contact_name,
      providerContactEmail: record.provider_contact_email,
      requestedPermissions: parsePermissions(record.requested_permissions),
      approvedPermissions,
      status: record.status,
      emailDeliveryStatus: record.email_delivery_status,
      requestedAt: record.requested_at,
      decidedAt: record.decided_at,
      expiresAt: record.expires_at,
      managerNotes: record.manager_notes,
      effectiveAccess: approvedPermissions.map((permission) => ({ permission, ...evaluateAuthorization(record, permission) })),
      providerVerification: providerVerification ? {
        status: providerVerification.status,
        deliveryMethod: providerVerification.delivery_method,
        feedFormat: providerVerification.feed_format,
        connectionNotes: providerVerification.connection_notes,
        decidedAt: providerVerification.decided_at,
      } : null,
    },
    auditEvents: auditEvents.map((event) => ({
      id: event.id,
      actorType: event.actor_type,
      actorEmail: event.actor_email,
      action: event.action,
      metadata: JSON.parse(event.metadata || "{}"),
      createdAt: event.created_at,
    })),
  });
}
