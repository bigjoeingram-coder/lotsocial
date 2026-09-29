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
      mode: "single",
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
    assert.match(html, /Sign in to your workspace/);
    assert.doesNotMatch(html, /Sign in to your dealership workspace/);
    assert.match(html, /type="email"/);
    assert.match(html, /autocomplete="email"/i);
  } finally {
    await worker.dispose();
  }
});

test("one private multi-use link lets a new associate create a workspace", async () => {
  const sharedToken = "shared-private-signup-token-that-is-long-enough";
  const worker = await startTier2Worker({
    LOTSOCIAL_SHARED_JOIN_TOKEN: sharedToken,
    LOTSOCIAL_DAILY_PUBLIC_SIGNUP_CAP: "50",
    LOTSOCIAL_SHARED_JOIN_EXPIRES_AT: "2099-12-31T23:59:59.000Z",
    LOTSOCIAL_SHARED_JOIN_MAX_SIGNUPS: "25",
  });
  try {
    const linkResponse = await worker.fetch(`https://lotsocial.test/api/pilot-invites/${sharedToken}`);
    assert.equal(linkResponse.status, 200);
    assert.deepEqual((await linkResponse.json()).invite, { mode: "shared", expiresAt: "2099-12-31T23:59:59.000Z" });

    const signupResponse = await worker.fetch(`https://lotsocial.test/api/pilot-invites/${sharedToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": "192.0.2.10" },
      body: JSON.stringify({
        displayName: "Taylor Sales",
        email: "taylor@exampledealer.com",
        phone: "(555) 555-0101",
        dealershipName: "Example Dealer",
        dealershipDomain: "https://www.exampledealer.com/inventory",
        rooftopLocation: "Irvine, CA",
      }),
    });
    assert.equal(signupResponse.status, 201);
    assert.match(signupResponse.headers.get("set-cookie") ?? "", /^lotsocial_session=/);

    const joinPage = await worker.fetch(`https://lotsocial.test/join/${sharedToken}`);
    const html = await joinPage.text();
    assert.match(html, /Create your workspace/);
    assert.doesNotMatch(html, /Create your dealership workspace/);
  } finally {
    await worker.dispose();
  }
});

test("shared signup rejects personal email providers and mismatched dealership domains", async () => {
  const sharedToken = "shared-private-signup-token-with-domain-guards";
  const worker = await startTier2Worker({
    LOTSOCIAL_SHARED_JOIN_TOKEN: sharedToken,
    LOTSOCIAL_SHARED_JOIN_EXPIRES_AT: "2099-12-31T23:59:59.000Z",
    LOTSOCIAL_SHARED_JOIN_MAX_SIGNUPS: "25",
  });
  try {
    for (const body of [
      { email: "salesperson@gmail.com", dealershipDomain: "gmail.com" },
      { email: "sales@dealer-one.example", dealershipDomain: "dealer-two.example" },
    ]) {
      const response = await worker.fetch(`https://lotsocial.test/api/pilot-invites/${sharedToken}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "cf-connecting-ip": "192.0.2.11" },
        body: JSON.stringify({
          displayName: "Guard Test",
          phone: "555-555-0102",
          dealershipName: "Guard Motors",
          rooftopLocation: "Irvine, CA",
          ...body,
        }),
      });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, /dealership|work-email domain/i);
    }
  } finally {
    await worker.dispose();
  }
});

test("shared signup link expires and enforces its lifetime seat ceiling", async () => {
  const expiredToken = "expired-private-signup-token-that-is-long-enough";
  const expiredWorker = await startTier2Worker({
    LOTSOCIAL_SHARED_JOIN_TOKEN: expiredToken,
    LOTSOCIAL_SHARED_JOIN_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
    LOTSOCIAL_SHARED_JOIN_MAX_SIGNUPS: "1",
  });
  try {
    assert.equal((await expiredWorker.fetch(`https://lotsocial.test/api/pilot-invites/${expiredToken}`)).status, 404);
  } finally {
    await expiredWorker.dispose();
  }

  const cappedToken = "capped-private-signup-token-that-is-long-enough";
  const cappedWorker = await startTier2Worker({
    LOTSOCIAL_SHARED_JOIN_TOKEN: cappedToken,
    LOTSOCIAL_SHARED_JOIN_EXPIRES_AT: "2099-12-31T23:59:59.000Z",
    LOTSOCIAL_SHARED_JOIN_MAX_SIGNUPS: "1",
  });
  try {
    const signup = async (email, ip) => cappedWorker.fetch(`https://lotsocial.test/api/pilot-invites/${cappedToken}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
      body: JSON.stringify({
        displayName: "Seat Test",
        email,
        phone: "555-555-0103",
        dealershipName: "Seat Motors",
        dealershipDomain: "seatmotors.example",
        rooftopLocation: "Irvine, CA",
      }),
    });
    assert.equal((await signup("first@seatmotors.example", "192.0.2.21")).status, 201);
    const second = await signup("second@seatmotors.example", "192.0.2.22");
    assert.equal(second.status, 400);
    assert.match((await second.json()).error, /seat limit/i);
    assert.equal((await cappedWorker.fetch(`https://lotsocial.test/api/pilot-invites/${cappedToken}`)).status, 404);
  } finally {
    await cappedWorker.dispose();
  }
});
