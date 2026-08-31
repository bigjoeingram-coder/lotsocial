import assert from "node:assert/strict";
import test from "node:test";
import { handleAuthorizationRequestsPost } from "../app/lib/authorization-requests-handler.ts";
import { handleVdpImportsPost } from "../app/lib/vdp-imports-handler.ts";
import { importedVehicle, jsonRequest, signedInUser, SqliteD1, testEnv } from "./harness.mjs";

function authorizationBody(overrides = {}) {
  return {
    dealershipName: "Ingram Ford",
    rooftopLocation: "Danville, KY",
    dealershipDomain: "ingramford.example",
    managerName: "Mary Manager",
    managerTitle: "General Manager",
    managerEmail: "mary@ingramford.example",
    requestedPermissions: ["vehicle_facts", "pricing"],
    ...overrides,
  };
}

test("concurrent VDP imports never allow more than the associate daily cap", async () => {
  const db = new SqliteD1();
  const cap = 3;
  let saves = 0;
  try {
    const env = testEnv({ DB: db, LOTSOCIAL_DAILY_VDP_IMPORT_CAP: String(cap) });
    const requests = Array.from({ length: 12 }, (_, index) =>
      handleVdpImportsPost(
        jsonRequest("https://lotsocial.test/api/vdp-imports", "POST", {
          sourceUrl: `https://dealer.example/vdp/${index}`,
          authorizedToMarket: true,
        }),
        env,
        {
          associate: signedInUser,
          getImportedVehicleBySourceUrl: async () => null,
          extractVehicleFromVdp: async (sourceUrl) => ({
            sourceUrl,
            sourceHost: "dealer.example",
            title: "New extracted vehicle",
            vin: "1HGBH41JXMN109186",
            stockNumber: "A2",
            year: "2026",
            make: "Test",
            model: "Vehicle",
            trim: "",
            price: "45000",
            currency: "USD",
            description: "",
            imageUrls: [],
            facts: {},
          }),
          saveImportedVehicle: async (_associateEmail, vehicle) => {
            saves += 1;
            return importedVehicle({ id: `veh_${saves}`, title: vehicle.title, source_url: vehicle.sourceUrl });
          },
        },
      ));

    const responses = await Promise.all(requests);
    const statuses = responses.map((response) => response.status);
    assert.equal(statuses.filter((status) => status === 201).length, cap);
    assert.equal(statuses.filter((status) => status === 429).length, responses.length - cap);
    assert.equal(saves, cap);
    assert.deepEqual(db.rows("SELECT counter_key, counter_day, count FROM rate_limit_counters").map((row) => ({ ...row })), [{
      counter_key: "vdp_imports:joe@example.com",
      counter_day: new Date().toISOString().slice(0, 10),
      count: 12,
    }]);
  } finally {
    db.close();
  }
});

test("VDP import caps are per associate, not global", async () => {
  const db = new SqliteD1();
  try {
    const env = testEnv({ DB: db, LOTSOCIAL_DAILY_VDP_IMPORT_CAP: "1" });
    const firstAssociate = await handleVdpImportsPost(
      jsonRequest("https://lotsocial.test/api/vdp-imports", "POST", {
        sourceUrl: "https://dealer.example/vdp/1",
        authorizedToMarket: true,
      }),
      env,
      {
        associate: signedInUser,
        getImportedVehicleBySourceUrl: async () => importedVehicle({ id: "veh_1" }),
      },
    );
    const secondAssociate = await handleVdpImportsPost(
      jsonRequest("https://lotsocial.test/api/vdp-imports", "POST", {
        sourceUrl: "https://dealer.example/vdp/2",
        authorizedToMarket: true,
      }),
      env,
      {
        associate: { ...signedInUser, email: "sam@example.com" },
        getImportedVehicleBySourceUrl: async () => importedVehicle({ id: "veh_2", associate_email: "sam@example.com" }),
      },
    );

    assert.equal(firstAssociate.status, 200);
    assert.equal(secondAssociate.status, 200);
  } finally {
    db.close();
  }
});

test("authorization requests enforce the associate daily cap before email delivery", async () => {
  const db = new SqliteD1();
  let deliveries = 0;
  try {
    const env = testEnv({
      DB: db,
      LOTSOCIAL_DAILY_AUTHORIZATION_REQUEST_CAP: "2",
      LOTSOCIAL_DAILY_MANAGER_EMAIL_CAP: "10",
    });
    const dependencies = {
      associate: signedInUser,
      createId: () => crypto.randomUUID(),
      createToken: () => crypto.randomUUID().replaceAll("-", ""),
      createAuthorizationRequest: async () => undefined,
      setEmailDelivery: async () => undefined,
      deliverEmail: async () => {
        deliveries += 1;
        return { status: "preview_ready" };
      },
    };

    const responses = await Promise.all(Array.from({ length: 4 }, (_, index) =>
      handleAuthorizationRequestsPost(
        jsonRequest("https://lotsocial.test/api/authorization-requests", "POST", authorizationBody({
          managerEmail: `manager${index}@ingramford.example`,
        })),
        env,
        dependencies,
      )));

    assert.equal(responses.filter((response) => response.status === 201).length, 2);
    assert.equal(responses.filter((response) => response.status === 429).length, 2);
    assert.equal(deliveries, 2);
  } finally {
    db.close();
  }
});

test("authorization requests enforce the manager-address daily cap", async () => {
  const db = new SqliteD1();
  let deliveries = 0;
  try {
    const env = testEnv({
      DB: db,
      LOTSOCIAL_DAILY_AUTHORIZATION_REQUEST_CAP: "10",
      LOTSOCIAL_DAILY_MANAGER_EMAIL_CAP: "1",
    });
    const dependencies = {
      associate: signedInUser,
      createId: () => crypto.randomUUID(),
      createToken: () => crypto.randomUUID().replaceAll("-", ""),
      createAuthorizationRequest: async () => undefined,
      setEmailDelivery: async () => undefined,
      deliverEmail: async () => {
        deliveries += 1;
        return { status: "preview_ready" };
      },
    };

    const first = await handleAuthorizationRequestsPost(
      jsonRequest("https://lotsocial.test/api/authorization-requests", "POST", authorizationBody()),
      env,
      dependencies,
    );
    const second = await handleAuthorizationRequestsPost(
      jsonRequest("https://lotsocial.test/api/authorization-requests", "POST", authorizationBody()),
      env,
      dependencies,
    );

    assert.equal(first.status, 201);
    assert.equal(second.status, 429);
    assert.equal(deliveries, 1);
  } finally {
    db.close();
  }
});

test("manager email outside the dealership domain policy is refused before email is sent", async () => {
  const db = new SqliteD1();
  let persisted = false;
  let delivered = false;
  try {
    const env = testEnv({ DB: db });
    const response = await handleAuthorizationRequestsPost(
      jsonRequest("https://lotsocial.test/api/authorization-requests", "POST", authorizationBody({
        dealershipDomain: "ingramford.example",
        managerEmail: "mary@outside.example",
      })),
      env,
      {
        associate: signedInUser,
        createAuthorizationRequest: async () => {
          persisted = true;
        },
        setEmailDelivery: async () => undefined,
        deliverEmail: async () => {
          delivered = true;
          return { status: "sent", messageId: "msg_1" };
        },
      },
    );

    assert.equal(response.status, 400);
    assert.equal(persisted, false);
    assert.equal(delivered, false);
    assert.deepEqual(await response.json(), {
      error: "Manager email must match the dealership domain policy. Use a dealership-domain manager address or ask the LotSocial owner to review it.",
    });
  } finally {
    db.close();
  }
});
