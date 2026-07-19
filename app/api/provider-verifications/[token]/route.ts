import { getProviderVerificationByToken, parsePermissions } from "../../../lib/authorization";

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const record = await getProviderVerificationByToken(token);
  if (!record) return Response.json({ error: "This provider verification link is invalid." }, { status: 404 });
  return Response.json({
    verification: {
      dealershipName: record.dealership_name,
      rooftopLocation: record.rooftop_location,
      associateName: record.associate_name,
      managerName: record.manager_name,
      providerName: record.provider_name,
      contactName: record.contact_name,
      contactEmail: record.contact_email,
      approvedPermissions: parsePermissions(record.approved_permissions),
      deliveryMethod: record.delivery_method,
      feedFormat: record.feed_format,
      connectionNotes: record.connection_notes,
      status: record.status,
    },
  });
}
