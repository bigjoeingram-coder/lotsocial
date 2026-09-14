import assert from "node:assert/strict";
import test from "node:test";
import { normalizeDealerDomain, normalizePhone, normalizeWorkEmail } from "../app/lib/account-auth.ts";
import { startTier2Worker } from "./harness.mjs";

test("customer account fields normalize work email, dealership domain, and phone", () => {
  assert.equal(normalizeWorkEmail(" SALES@Dealer.Example "), "sales@dealer.example");
  assert.equal(normalizeDealerDomain("https://www.Dealer.Example/inventory"), "dealer.example");
  assert.equal(normalizePhone("(555) 555-0100"), "(555) 555-0100");
  assert.equal(normalizePhone("555"), "");
});

test("an invited customer creates an onsite account and reaches the API without ChatGPT headers", async () => {
  const worker = await startTier2Worker({ ENFORCEMENT_API_KEY: "test-enforcement-key" });
  try {
    const inviteResponse = await worker.fetch("https://lotsocial.test/api/pilot-invites", {
      method: "POST",
      headers: { Authorization: "Bearer test-enforcement-key", "Content-Type": "application/json" },
      body: JSON.stringify({ email: "sales@dealer.example", dealershipName: "Dealer Motors", dealershipDomain: "dealer.example" }),
    });
    assert.equal(inviteResponse.status, 201);
    const invitePayload = await inviteResponse.json();
    const token = new URL(invitePayload.joinUrl).pathname.split("/").at(-1);
    assert.ok(token);

    const publicInvite = await worker.fetch(`https://lotsocial.test/api/pilot-invites/${token}`);
    assert.equal(publicInvite.status, 200);
    assert.deepEqual((await publicInvite.json()).invite, {
      email: "sales@dealer.example",
      dealershipName: "Dealer Motors",
      dealershipDomain: "dealer.example",
      expiresAt: invitePayload.invite.expiresAt,
    });

    const signupResponse = await worker.fetch(`https://lotsocial.test/api/pilot-invites/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Sam Sales", email: "sales@dealer.example", phone: "(555) 555-0100", rooftopLocation: "Waconia, MN" }),
    });
    assert.equal(signupResponse.status, 201);
    const cookie = signupResponse.headers.get("set-cookie");
    assert.match(cookie ?? "", /^lotsocial_session=/);
    assert.match(cookie ?? "", /HttpOnly/);
    assert.match(cookie ?? "", /Secure/);
    assert.match(cookie ?? "", /SameSite=Lax/);

    const apiResponse = await worker.fetch("https://lotsocial.test/api/vdp-imports", { headers: { Cookie: cookie.split(";")[0] } });
    assert.equal(apiResponse.status, 200);
    assert.deepEqual(await apiResponse.json(), { vehicles: [] });

    const reusedInvite = await worker.fetch(`https://lotsocial.test/api/pilot-invites/${token}`);
    assert.equal(reusedInvite.status, 404);
  } finally {
    await worker.dispose();
  }
});

test("the public login page uses work email and does not require ChatGPT", async () => {
  const worker = await startTier2Worker();
  try {
    const response = await worker.fetch("https://lotsocial.test/login");
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(html, /Work email/);
    assert.match(html, /No ChatGPT account is required/);
    assert.match(html, /type="email"/);
    assert.match(html, /autocomplete="email"/i);
  } finally {
    await worker.dispose();
  }
});
