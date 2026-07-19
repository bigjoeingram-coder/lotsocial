import { getAuthorizationByToken, parsePermissions } from "../../../lib/authorization";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const record = await getAuthorizationByToken(token);
  if (!record) return Response.json({ error: "This authorization link is invalid or has expired." }, { status: 404 });

  return Response.json({
    request: {
      id: record.id,
      dealershipName: record.dealership_name,
      rooftopLocation: record.rooftop_location,
      associateName: record.associate_name,
      managerName: record.manager_name,
      managerTitle: record.manager_title,
      managerEmail: record.manager_email,
      providerName: record.provider_name,
      providerContactName: record.provider_contact_name,
      providerContactEmail: record.provider_contact_email,
      requestedPermissions: parsePermissions(record.requested_permissions),
      approvedPermissions: parsePermissions(record.approved_permissions),
      status: record.status,
      requestedAt: record.requested_at,
      expiresAt: record.expires_at,
      termsVersion: record.terms_version,
    },
  });
}
