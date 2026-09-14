import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthorizationRequest,
  decideAuthorization,
  evaluateAuthorization,
  getAuthorizationByManagementToken,
  getAuthorizationByToken,
  issueManagementToken,
  manageAuthorization,
  hashToken,
} from "../app/lib/authorization.ts";
import { ensureLotSocialSchema, resetSchemaBootstrapForTests } from "../app/lib/schema-bootstrap.ts";
import { SqliteD1, testEnv } from "./harness.mjs";

const requestedPermissions = ["vehicle_facts", "pricing", "images", "descriptions", "window_stickers", "social_publishing"];

function record(status, overrides = {}) {
  return {
    id: "auth-1", management_token_hash: null, management_token_expires_at: null,
    dealership_name: "Test Motors", rooftop_location: "Irvine", dealership_domain: "testmotors.com",
    associate_name: "Joe Associate", associate_email: "joe@example.com", manager_name: "Manny Manager",
    manager_title: "GM", manager_email: "manny@testmotors.com", manager_phone: "", provider_name: "Provider",
    provider_contact_name: "", provider_contact_email: "", requested_permissions: JSON.stringify(requestedPermissions),
    approved_permissions: JSON.stringify(requestedPermissions), status, email_delivery_status: "sent", email_message_id: null,
    typed_signature: "Manny Manager", manager_notes: "", terms_version: "2026-07-18-v1", requested_at: "2026-09-14 00:00:00",
    decided_at: null, expires_at: null, created_at: "2026-09-14 00:00:00", updated_at: "2026-09-14 00:00:00",
    ...overrides,
  };
}

test("manager-grantable permissions become effective immediately after manager approval", () => {
  for (const permission of ["vehicle_facts", "pricing", "social_publishing"]) {
    assert.deepEqual(evaluateAuthorization(record("manager_approved"), permission), { allowed: true, reason: "manager_authorized" });
  }
  for (const permission of ["images", "descriptions", "window_stickers"]) {
    assert.deepEqual(evaluateAuthorization(record("manager_approved"), permission), { allowed: false, reason: "provider_verification_required" });
  }
});

test("provider-gated permissions turn on only after provider verification", () => {
  assert.deepEqual(evaluateAuthorization(record("provider_pending"), "images"), { allowed: false, reason: "provider_verification_required" });
  assert.deepEqual(evaluateAuthorization(record("provider_declined"), "images"), { allowed: false, reason: "provider_declined" });
  assert.deepEqual(evaluateAuthorization(record("provider_verified"), "images"), { allowed: true, reason: "provider_authorized" });
  assert.deepEqual(evaluateAuthorization(record("provider_declined"), "pricing"), { allowed: true, reason: "manager_authorized" });
});

test("state matrix is honest for requested, suspended, revoked, expired and unapproved permissions", () => {
  assert.equal(evaluateAuthorization(record("requested"), "pricing").reason, "manager_approval_required");
  assert.equal(evaluateAuthorization(record("suspended"), "pricing").reason, "authorization_suspended");
  assert.equal(evaluateAuthorization(record("revoked"), "pricing").reason, "authorization_revoked");
  assert.equal(evaluateAuthorization(record("manager_approved", { expires_at: "2020-01-01" }), "pricing").reason, "authorization_expired");
  assert.equal(evaluateAuthorization(record("manager_approved", { approved_permissions: JSON.stringify(["pricing"]) }), "vehicle_facts").reason, "permission_not_approved");
});

async function seededAuthorization() {
  resetSchemaBootstrapForTests();
  const DB = new SqliteD1();
  const env = testEnv({ DB });
  await ensureLotSocialSchema(env);
  const approvalToken = "approval-token";
  await createAuthorizationRequest({
    id: "auth-1", tokenHash: await hashToken(approvalToken), dealershipName: "Test Motors", rooftopLocation: "Irvine",
    dealershipDomain: "testmotors.com", associateName: "Joe Associate", associateEmail: "joe@example.com", managerName: "Manny Manager",
    managerTitle: "GM", managerEmail: "manny@testmotors.com", managerPhone: "", providerName: "Provider", providerContactName: "",
    providerContactEmail: "", requestedPermissions, env,
  });
  return { DB, env, approvalToken };
}

test("approval retires the one-time approval token and creates an expiring management token", async () => {
  const { DB, env, approvalToken } = await seededAuthorization();
  const managementToken = "manage-token-1";
  const result = await decideAuthorization({
    token: approvalToken, decision: "approved", typedSignature: "Manny Manager", approvedPermissions: requestedPermissions,
    providerName: "Provider", providerContactName: "", providerContactEmail: "", expiresAt: null, managerNotes: "", managementToken, env,
  });
  assert.equal(result?.record.status, "manager_approved");
  assert.equal(await getAuthorizationByToken(approvalToken, env), null);
  const lookup = await getAuthorizationByManagementToken(managementToken, env);
  assert.equal(lookup.expired, false);
  assert.equal(lookup.record?.id, "auth-1");
  DB.close();
});

test("reissue rotates the management token and expired links fail closed", async () => {
  const { DB, env, approvalToken } = await seededAuthorization();
  const firstToken = "manage-token-1";
  await decideAuthorization({ token: approvalToken, decision: "approved", typedSignature: "Manny", approvedPermissions: requestedPermissions, providerName: "Provider", providerContactName: "", providerContactEmail: "", expiresAt: null, managerNotes: "", managementToken: firstToken, env });
  const recordAfterApproval = (await getAuthorizationByManagementToken(firstToken, env)).record;
  assert(recordAfterApproval);
  const secondToken = "manage-token-2";
  await issueManagementToken({ record: recordAfterApproval, token: secondToken, env, actorType: "associate", actorEmail: "joe@example.com" });
  assert.equal((await getAuthorizationByManagementToken(firstToken, env)).record, null);
  assert.equal((await getAuthorizationByManagementToken(secondToken, env)).expired, false);
  DB.db.prepare("UPDATE authorization_requests SET management_token_expires_at = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", "auth-1");
  assert.equal((await getAuthorizationByManagementToken(secondToken, env)).expired, true);
  const management = await manageAuthorization({ token: secondToken, action: "update", approvedPermissions: ["pricing"], expiresAt: null, managerNotes: "", env });
  assert.equal(management?.expired, true);
  DB.close();
});
