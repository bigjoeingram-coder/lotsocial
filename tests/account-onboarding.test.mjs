import assert from "node:assert/strict";
import test from "node:test";
import {
  beginPilotInvite,
  beginSharedJoin,
  consumeAccountEmailVerification,
  createPilotInvite,
  normalizeDealerDomain,
  normalizePhone,
  normalizeWorkEmail,
} from "../app/lib/account-auth.ts";
import { sendAccountAccessEmail } from "../app/lib/account-email.ts";
import { accountLinkConfirmation } from "../app/lib/account-link-confirmation.ts";
import { SqliteD1, startTier2Worker, testEnv } from "./harness.mjs";

test("customer account fields normalize work email, dealership domain, and phone", () => {
  assert.equal(normalizeWorkEmail(" SALES@Dealer.Example "), "sales@dealer.example");
  assert.equal(normalizeDealerDomain("https://www.Dealer.Example/inventory"), "dealer.example");
  assert.equal(normalizePhone("(555) 555-0100"), "(555) 555-0100");
  assert.equal(normalizePhone("555"), "");
});

test("an invited customer must verify email before an onsite account is created", async () => {
  const DB = new SqliteD1();
  const env = testEnv({ DB });
  try {
    const invite = await createPilotInvite({
      email: "sales@dealer.example",
      dealershipName: "Dealer Motors",
      dealershipDomain: "dealer.example",
      env,
    });
    const verification = await beginPilotInvite({
      token: invite.token,
      displayName: "Sam Sales",
      email: "sales@dealer.example",
      phone: "(555) 555-0100",
      rooftopLocation: "Waconia, MN",
      env,
    });
    assert.equal(verification.kind, "verification");
    assert.equal(DB.rows("SELECT * FROM associate_accounts").length, 0);
    assert.equal(DB.rows("SELECT * FROM associate_sessions").length, 0);

    const session = await consumeAccountEmailVerification(verification.token, env);
    assert.ok(session?.rawSession);
    assert.equal(DB.rows("SELECT * FROM associate_accounts").length, 1);
    assert.equal(DB.rows("SELECT * FROM associate_sessions").length, 1);
    assert.equal(DB.rows("SELECT event_type FROM usage_events")[0].event_type, "account_created");
    assert.equal(await consumeAccountEmailVerification(verification.token, env), null);
  } finally {
    DB.close();
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

test("one private multi-use link creates an account only after email verification", async () => {
  const sharedToken = "shared-private-signup-token-that-is-long-enough";
  const DB = new SqliteD1();
  const env = testEnv({
    DB,
    LOTSOCIAL_SHARED_JOIN_TOKEN: sharedToken,
    LOTSOCIAL_DAILY_PUBLIC_SIGNUP_CAP: "50",
    LOTSOCIAL_SHARED_JOIN_EXPIRES_AT: "2099-12-31T23:59:59.000Z",
    LOTSOCIAL_SHARED_JOIN_MAX_SIGNUPS: "25",
  });
  try {
    const verification = await beginSharedJoin({
      token: sharedToken,
      displayName: "Taylor Sales",
      email: "taylor@exampledealer.com",
      phone: "(555) 555-0101",
      dealershipName: "Example Dealer",
      dealershipDomain: "https://www.exampledealer.com/inventory",
      rooftopLocation: "Irvine, CA",
      env,
    });
    assert.equal(verification.kind, "verification");
    assert.equal(DB.rows("SELECT * FROM associate_accounts").length, 0);
    assert.ok(await consumeAccountEmailVerification(verification.token, env));
    assert.equal(DB.rows("SELECT signup_count FROM shared_join_tokens")[0].signup_count, 1);
  } finally {
    DB.close();
  }
});

test("an existing email cannot be taken over through the shared join form", async () => {
  const sharedToken = "shared-private-signup-token-for-takeover-test";
  const DB = new SqliteD1();
  const env = testEnv({ DB, LOTSOCIAL_SHARED_JOIN_TOKEN: sharedToken });
  try {
    const first = await beginSharedJoin({
      token: sharedToken,
      displayName: "Taylor Owner",
      email: "taylor@exampledealer.com",
      phone: "(555) 555-0101",
      dealershipName: "Example Dealer",
      dealershipDomain: "exampledealer.com",
      rooftopLocation: "Irvine, CA",
      env,
    });
    assert.equal(first.kind, "verification");
    assert.ok(await consumeAccountEmailVerification(first.token, env));
    const sessionCount = DB.rows("SELECT * FROM associate_sessions").length;

    const takeover = await beginSharedJoin({
      token: sharedToken,
      displayName: "Attacker Changed Name",
      email: "taylor@exampledealer.com",
      phone: "(555) 555-0199",
      dealershipName: "Attacker Dealer",
      dealershipDomain: "exampledealer.com",
      rooftopLocation: "Elsewhere",
      env,
    });

    assert.equal(takeover.kind, "login");
    assert.equal(DB.rows("SELECT * FROM associate_sessions").length, sessionCount);
    assert.equal(DB.rows("SELECT * FROM account_login_links").length, 1);
    assert.equal(DB.rows("SELECT * FROM account_email_verifications").length, 1);
    const account = DB.rows("SELECT * FROM associate_accounts")[0];
    assert.equal(account.display_name, "Taylor Owner");
    assert.equal(account.phone, "(555) 555-0101");
    assert.equal(account.dealership_name, "Example Dealer");
  } finally {
    DB.close();
  }
});

test("account access emails send the correct single-use magic-link route", async () => {
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(null, { status: 202 });
  };
  const env = testEnv({ RESEND_API_KEY: "test-key", EMAIL_FROM: "LotSocial <access@example.com>" });
  try {
    assert.equal(await sendAccountAccessEmail({
      kind: "verification", token: "verify-token", email: "new@dealer.example", displayName: "New User", expiresAt: "2099-01-01T00:00:00.000Z",
    }, env), true);
    assert.match(requests[0].body.text, /https:\/\/lotsocial\.test\/verify\/verify-token/);
    assert.deepEqual(requests[0].body.to, ["new@dealer.example"]);

    assert.equal(await sendAccountAccessEmail({
      kind: "login", token: "login-token", email: "existing@dealer.example", displayName: "Existing User", expiresAt: "2099-01-01T00:00:00.000Z",
    }, env), true);
    assert.match(requests[1].body.text, /https:\/\/lotsocial\.test\/login\/login-token/);
    assert.deepEqual(requests[1].body.to, ["existing@dealer.example"]);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("magic-link landing pages require an explicit POST before consuming a token", async () => {
  for (const [kind, label] of [
    ["verification", "Verify and continue"],
    ["login", "Sign in and continue"],
  ]) {
    const response = accountLinkConfirmation(kind);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
    assert.match(html, /<form method="post">/);
    assert.match(html, new RegExp(label));
    assert.doesNotMatch(html, /http-equiv=["']refresh/i);
    assert.doesNotMatch(html, /\.submit\s*\(/);
  }
});

test("the built worker does not consume verification or login links on GET", async () => {
  const worker = await startTier2Worker();
  try {
    for (const path of ["/verify/scanner-prefetch-token", "/login/scanner-prefetch-token"]) {
      const response = await worker.fetch(`https://lotsocial.test${path}`);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.match(html, /<form method="post">/);
      assert.doesNotMatch(html, /invalid_(?:verification|link)/);
    }
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
  const expiredDb = new SqliteD1();
  const expiredEnv = testEnv({
    DB: expiredDb,
    LOTSOCIAL_SHARED_JOIN_TOKEN: expiredToken,
    LOTSOCIAL_SHARED_JOIN_EXPIRES_AT: "2020-01-01T00:00:00.000Z",
    LOTSOCIAL_SHARED_JOIN_MAX_SIGNUPS: "1",
  });
  try {
    await assert.rejects(beginSharedJoin({
      token: expiredToken,
      displayName: "Expired User",
      email: "expired@seatmotors.example",
      phone: "555-555-0103",
      dealershipName: "Seat Motors",
      dealershipDomain: "seatmotors.example",
      rooftopLocation: "Irvine, CA",
      env: expiredEnv,
    }), /expired|full/i);
  } finally {
    expiredDb.close();
  }

  const cappedToken = "capped-private-signup-token-that-is-long-enough";
  const cappedDb = new SqliteD1();
  const cappedEnv = testEnv({
    DB: cappedDb,
    LOTSOCIAL_SHARED_JOIN_TOKEN: cappedToken,
    LOTSOCIAL_SHARED_JOIN_EXPIRES_AT: "2099-12-31T23:59:59.000Z",
    LOTSOCIAL_SHARED_JOIN_MAX_SIGNUPS: "1",
  });
  try {
    const signup = (email) => beginSharedJoin({
        token: cappedToken,
        displayName: "Seat Test",
        email,
        phone: "555-555-0103",
        dealershipName: "Seat Motors",
        dealershipDomain: "seatmotors.example",
        rooftopLocation: "Irvine, CA",
        env: cappedEnv,
    });
    const first = await signup("first@seatmotors.example");
    assert.equal(first.kind, "verification");
    assert.ok(await consumeAccountEmailVerification(first.token, cappedEnv));
    await assert.rejects(signup("second@seatmotors.example"), /expired|full/i);
  } finally {
    cappedDb.close();
  }
});
