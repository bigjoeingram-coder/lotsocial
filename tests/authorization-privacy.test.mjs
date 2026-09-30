import assert from "node:assert/strict";
import test from "node:test";
import {
  createAuthorizationRequest,
  getAuthorizationByIdForAssociate,
  listAuthorizationRequests,
} from "../app/lib/authorization.ts";
import { SqliteD1, testEnv } from "./harness.mjs";

async function seedRequest(id, associateEmail, env) {
  await createAuthorizationRequest({
    id,
    tokenHash: `token-${id}`,
    dealershipName: `${id} Motors`,
    rooftopLocation: "Irvine, CA",
    dealershipDomain: `${id}.example`,
    associateName: id,
    associateEmail,
    managerName: "Manager",
    managerTitle: "General Manager",
    managerEmail: `manager@${id}.example`,
    managerPhone: "",
    providerName: "Unknown",
    providerContactName: "",
    providerContactEmail: "",
    requestedPermissions: ["vehicle_facts"],
    env,
  });
}

test("authorization ledger lists only the signed-in associate's requests", async () => {
  const DB = new SqliteD1();
  const env = testEnv({ DB });
  try {
    await seedRequest("joe", "joe@dealer.example", env);
    await seedRequest("sam", "sam@dealer.example", env);

    const joeRequests = await listAuthorizationRequests("JOE@DEALER.EXAMPLE", 20, env);
    const samRequests = await listAuthorizationRequests("sam@dealer.example", 20, env);

    assert.deepEqual(joeRequests.map((request) => request.id), ["joe"]);
    assert.deepEqual(samRequests.map((request) => request.id), ["sam"]);
  } finally {
    DB.close();
  }
});

test("authorization details cannot be opened by a different associate", async () => {
  const DB = new SqliteD1();
  const env = testEnv({ DB });
  try {
    await seedRequest("joe", "joe@dealer.example", env);

    assert.equal(await getAuthorizationByIdForAssociate("joe", "sam@dealer.example", env), null);
    assert.equal((await getAuthorizationByIdForAssociate("joe", "joe@dealer.example", env))?.id, "joe");
  } finally {
    DB.close();
  }
});
