import assert from "node:assert/strict";
import test from "node:test";
import { createCopy } from "../app/lib/creative.ts";
import { replenishSelectedImages } from "../app/lib/creative-selection.ts";
import { validateProfilePhotoFile, verifyProfilePhotoForSocial } from "../app/lib/image-moderation.ts";
import { buildVerticalRenderPlan, checkRender, prepareRenderCompatibleImages } from "../app/lib/rendering.ts";
import { normalizeVehicleYear } from "../app/lib/vdp.ts";
import { importedVehicle, testEnv } from "./harness.mjs";

const project = {
  id: "project_1",
  vehicle_id: "veh_1",
  associate_email: "joe@example.com",
  selected_images: JSON.stringify(["https://dealer.example/photo.avif", "https://dealer.example/photo.jpg"]),
  style: "walkaround",
  duration_seconds: 30,
  voiceover_script: "Clean script.",
  social_caption: "Clean caption.",
  end_card_name: "Joe",
  end_card_phone: "555-0100",
  end_card_email: "joe@example.com",
  end_card_cta: "Message me for details",
  end_card_photo_url: "",
  status: "storyboard_ready",
  created_at: "2026-09-14 00:00:00",
  updated_at: "2026-09-14 00:00:00",
};

test("public caption names the dealership host instead of saying VDP", () => {
  const vehicle = importedVehicle({ source_host: "waconia.furymotors.com", price: "43921" });
  const copy = createCopy(vehicle, "walkaround", 30, "Joe", "Message me for details");
  assert.match(copy.socialCaption, /Total price listed on waconia\.furymotors\.com: \$43,921\./);
  assert.doesNotMatch(copy.socialCaption, /listed on the VDP/i);
});

test("No, Light, and Extra Gravy create distinct copy without changing the compliance disclosures", () => {
  const vehicle = importedVehicle({ source_host: "dealer.example", price: "43921" });
  const noGravy = createCopy(vehicle, "walkaround", 30, "Joe", "Message me for details", "none");
  const lightGravy = createCopy(vehicle, "walkaround", 30, "Joe", "Message me for details", "light");
  const extraGravy = createCopy(vehicle, "walkaround", 30, "Joe", "Message me for details", "extra");

  assert.notEqual(noGravy.socialCaption, lightGravy.socialCaption);
  assert.notEqual(lightGravy.socialCaption, extraGravy.socialCaption);
  assert.doesNotMatch(noGravy.socialCaption, /confident presence/i);
  assert.match(lightGravy.socialCaption, /confident presence/i);
  assert.match(extraGravy.socialCaption, /Every angle brings another reason to keep watching/i);
  for (const copy of [noGravy, lightGravy, extraGravy]) {
    assert.match(copy.socialCaption, /Pricing and availability as shown on the dealer's website on .*UTC; subject to change\. Confirm current price with the dealership/);
    assert.match(copy.socialCaption, /Confirm equipment and eligibility with the dealership/);
    assert.match(copy.socialCaption, /expires 7 days after posting or when the vehicle sells/);
    assert.match(copy.socialCaption, /Total price listed on dealer\.example: \$43,921/);
  }
});

test("render styles produce genuinely different motion treatments", () => {
  const vehicle = importedVehicle();
  const plans = ["energetic", "walkaround", "premium"].map((style) => buildVerticalRenderPlan({ ...project, style }, vehicle));
  const treatments = plans.map((plan) => {
    const clip = plan.render.timeline.tracks[2].clips[0];
    return { effect: clip.effect, transition: clip.transition, scale: clip.scale };
  });
  assert.equal(new Set(treatments.map(JSON.stringify)).size, 3);
  assert.match(treatments[0].effect, /Fast$/);
  assert.match(treatments[1].effect, /Slow$/);
  assert.match(treatments[2].effect, /Slow$/);
});

test("rendered end card uses the associate photo, spaced contact order, and approved disclaimer without a vehicle-title ghost", () => {
  const withPhoto = { ...project, end_card_photo_url: "https://app.example/api/profile-photos/00000000-0000-4000-8000-000000000000.jpg" };
  const plan = buildVerticalRenderPlan(withPhoto, importedVehicle({ imported_at: "2026-09-14 16:20:00" }));
  const profileClip = plan.render.timeline.tracks[0].clips[0];
  const html = plan.render.timeline.tracks[1].clips[0].asset.html;
  assert.ok(plan.summary.endCardSeconds >= 5);
  assert.equal(profileClip.asset.src, withPhoto.end_card_photo_url);
  assert.ok(html.indexOf("Joe") < html.indexOf("555-0100"));
  assert.ok(html.indexOf("555-0100") < html.indexOf("Message me for details"));
  assert.ok(html.indexOf("Message me for details") < html.indexOf("Pricing and availability"));
  assert.ok(html.indexOf("Pricing and availability") < html.indexOf("LotSocial"));
  assert.doesNotMatch(html, /2025 Ford/);
});

test("vehicle dates are normalized to a public model year", () => {
  assert.equal(normalizeVehicleYear("2025-01-01"), "2025");
  assert.equal(normalizeVehicleYear("2025"), "2025");
});

test("a broken selected shot is replaced up to the ten-shot customer limit", () => {
  const available = Array.from({ length: 12 }, (_, index) => `photo-${index + 1}`);
  const selected = available.slice(0, 10);
  assert.deepEqual(
    replenishSelectedImages(selected, available, ["photo-10"]),
    [...available.slice(0, 9), "photo-11"],
  );
});

test("multiple broken shots are never reintroduced during replenishment", () => {
  const available = Array.from({ length: 12 }, (_, index) => `photo-${index + 1}`);
  const selected = available.slice(0, 10);
  const replenished = replenishSelectedImages(selected, available, ["photo-2", "photo-10"]);
  assert.deepEqual(replenished, [...available.slice(0, 10).filter((image) => !["photo-2", "photo-10"].includes(image)), "photo-11", "photo-12"]);
});

test("profile photos use local file validation when moderation is not configured", async () => {
  const file = new File([new Uint8Array([1, 2, 3])], "profile.jpg", { type: "image/jpeg" });
  assert.equal(validateProfilePhotoFile(file), "");
  assert.deepEqual(await verifyProfilePhotoForSocial(file, "data:image/jpeg;base64,AQID", testEnv()), {
    approved: true,
    error: "",
    verification: "file_validation",
  });
});

test("oversized profile photos are rejected before storage", () => {
  const file = new File([new Uint8Array(1024 * 1024 + 1)], "large.jpg", { type: "image/jpeg" });
  assert.match(validateProfilePhotoFile(file), /under 1 MB/);
});

test("AVIF dealership images are converted once and replaced in every render track", async () => {
  const originalFetch = globalThis.fetch;
  let ingestPosts = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/sources") && init.method === "POST") {
        ingestPosts += 1;
        return Response.json({ data: { id: "source_1" } }, { status: 201 });
      }
      if (url.endsWith("/sources/source_1")) {
        return Response.json({ data: { attributes: { status: "ready", outputs: { renditions: [{ status: "ready", url: "https://shotstack.example/photo.jpg" }] } } } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const plan = buildVerticalRenderPlan(project, importedVehicle());
    const compatible = await prepareRenderCompatibleImages(plan, "test-key", "stage");
    const imageSources = compatible.render.timeline.tracks.flatMap((track) => track.clips).map((clip) => clip.asset.src).filter(Boolean);
    assert.equal(ingestPosts, 1);
    assert.equal(imageSources.filter((src) => src === "https://shotstack.example/photo.jpg").length, 2);
    assert.equal(imageSources.some((src) => src.endsWith(".avif")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed renderer status keeps the provider's actionable error", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ response: { status: "failed", error: { message: "Could not decode source image" } } });
    const result = await checkRender("stage:render_1", testEnv({ SHOTSTACK_API_KEY: "test-key" }));
    assert.equal(result.status, "failed");
    assert.equal(result.errorMessage, "Could not decode source image");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
