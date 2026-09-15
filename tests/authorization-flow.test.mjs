import assert from "node:assert/strict";
import test from "node:test";
import {
  PERMISSIONS,
  createAuthorizationRequest,
  decideAuthorization,
  evaluateAuthorization,
  getAuthorizationByToken,
  hashToken,
  isManagementLinkExpired,
  manageAuthorization,
  rotateManagementLink,
} from "../app/lib/authorization.ts";
import { SqliteD1, testEnv } from "./harness.mjs";

const managerPermissions = new Set(["vehicle_facts", "pricing", "social_publishing"]);
const providerPermissions = new Set(["images", "descriptions", "window_stickers"]);
const liveManagerStatuses = new Set(["manager_approved", "provider_pending", "provider_verified", "provider_declined", "feed_connected", "active"]);
const liveProviderStatuses = new Set(["provider_verified", "feed_connected", "active"]);
const statuses = ["requested", "manager_approved", "provider_pending", "provider_verified", "provider_declined", "feed_connected", "active", "suspended", "revoked", "expired"];

function record(status, permissions = PERMISSIONS.map((permission) => permission.id)) {
  return { status, approved_permissions: JSON.stringify(permissions), expires_at: null };
}

test("authorization matrix preserves manager rights and gates provider rights in every reachable state", () => {
  for (const status of statuses) {
    for (const permission of PERMISSIONS) {
      const decision = evaluateAuthorization(record(status), permission.id);
      const expected = managerPermissions.has(permission.id)
        ? liveManagerStatuses.has(status)
        : liveProviderStatuses.has(status);
      assert.equal(decision.allowed, expected, `${permission.id} at ${status}`);
      if (!expected && providerPermissions.has(permission.id) && ["manager_approved", "provider_pending", "provider_declined"].includes(status)) {
        assert.equal(decision.reason, `provider_rights_${status}`);
      }
    }
  }
});

test("a provider decline does not silently switch off dealership-controlled permissions", () => {
  assert.equal(evaluateAuthorization(record("provider_declined"), "pricing").allowed, true);
  assert.equal(evaluateAuthorization(record("provider_declined"), "images").allowed, false);
});

test("unapproved and expired permissions fail closed", () => {
  assert.deepEqual(evaluateAuthorization(record("active", []), "pricing"), { allowed: false, reason: "permission_not_approved" });
  assert.deepEqual(evaluateAuthorization({ ...record("active"), expires_at: "2020-01-01" }, "pricing"), { allowed: false, reason: "authorization_expired" });
});

test("manager decision token becomes a time-limited management token and rotation invalidates it", async () => {
  const db = new SqliteD1();
  const env = testEnv({ DB: db, LOTSOCIAL_MANAGEMENT_LINK_TTL_HOURS: "2" });
  const token = "initial-manager-token";
  await createAuthorizationRequest({
    id: "auth-1", tokenHash: await hashToken(token), dealershipName: "Test Motors",
    rooftopLocation: "Main", dealershipDomain: "test.example", associateName: "Joe Associate",
    associateEmail: "joe@example.com", managerName: "Manny Manager", managerTitle: "GM",
    managerEmail: "manny@test.example", managerPhone: "", providerName: "Unknown",
    providerContactName: "", providerContactEmail: "", requestedPermissions: ["pricing", "images"], env,
  });
  const decided = await decideAuthorization({
    token, decision: "approved", typedSignature: "Manny Manager", approvedPermissions: ["pricing", "images"],
    providerName: "Unknown", providerContactName: "", providerContactEmail: "", expiresAt: null,
    managerNotes: "", env,
  });
  assert.equal(decided?.alreadyDecided, false);
  const managementRecord = await getAuthorizationByToken(token, env);
  assert.equal(isManagementLinkExpired(managementRecord, env), false);

  const changed = await manageAuthorization({ token, action: "update", approvedPermissions: ["pricing"], expiresAt: null, managerNotes: "", env });
  assert.equal(changed?.unavailable, false);

  const replacement = "replacement-manager-token";
  await rotateManagementLink("auth-1", await hashToken(replacement), env);
  assert.equal(await getAuthorizationByToken(token, env), null);
  assert.equal((await getAuthorizationByToken(replacement, env))?.id, "auth-1");
  db.close();
});

test("expired management tokens cannot change authorization", async () => {
  const recordWithExpiry = { ...record("manager_approved"), decided_at: "2026-09-13 00:00:00", management_link_expires_at: "2026-09-13T02:00:00.000Z" };
  assert.equal(isManagementLinkExpired(recordWithExpiry, testEnv(), new Date("2026-09-13T02:00:01.000Z")), true);
});
