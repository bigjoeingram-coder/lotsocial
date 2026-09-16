import assert from "node:assert/strict";
import test from "node:test";
import { createCopy } from "../app/lib/creative.ts";
import { replenishSelectedImages } from "../app/lib/creative-selection.ts";
import { validateProfilePhotoFile, verifyProfilePhotoForSocial } from "../app/lib/image-moderation.ts";
import { buildSignedRenderSourceUrls, buildVerticalRenderPlan, checkRender, inlineRenderProfilePhotos, prepareRenderCompatibleImages } from "../app/lib/rendering.ts";
import { serveRenderSourceImage } from "../app/lib/render-source.ts";
import { normalizeVehicleYear } from "../app/lib/vdp.ts";
import { FakeD1, importedVehicle, testEnv } from "./harness.mjs";

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

test("render styles produce genuinely different production templates", () => {
  const vehicle = importedVehicle();
  const plans = ["energetic", "walkaround", "premium"].map((style) => buildVerticalRenderPlan({ ...project, style }, vehicle));
  const treatments = plans.map((plan) => {
    const clip = plan.render.timeline.tracks.flatMap((track) => track.clips).find((candidate) => "effect" in candidate);
    return { effect: clip.effect, transition: clip.transition, scale: clip.scale };
  });
  assert.equal(new Set(treatments.map(JSON.stringify)).size, 3);
  assert.match(treatments[0].effect, /Fast$/);
  assert.match(treatments[1].effect, /Slow$/);
  assert.match(treatments[2].effect, /Slow$/);
  assert.equal(new Set(plans.map((plan) => plan.summary.template)).size, 3);
  assert.equal(new Set(plans.map((plan) => plan.render.timeline.background)).size, 3);
  assert.equal(new Set(plans.map((plan) => plan.render.timeline.tracks.at(-1).clips[0].asset.src)).size, 3);
  for (const plan of plans) {
    const music = plan.render.timeline.tracks.at(-1).clips[0];
    assert.equal(music.asset.type, "audio");
    assert.equal(music.asset.effect, "fadeInFadeOut");
    assert.ok(music.asset.volume > 0 && music.asset.volume < 0.3);
    assert.equal(music.length, 30);
  }
});

test("energetic render plans use Shotstack-valid fast transitions", () => {
  const plan = buildVerticalRenderPlan({ ...project, style: "energetic" }, importedVehicle());
  const vehicleClips = plan.render.timeline.tracks.flatMap((track) => track.clips).filter((clip) => "effect" in clip);

  assert.equal(vehicleClips[0].transition.out, "fadeFast");
  assert.equal(vehicleClips[1].transition.in, "wipeLeftFast");
  assert.equal(vehicleClips[1].transition.out, "fadeFast");
  assert.doesNotMatch(JSON.stringify(plan), /zoom(?:Fast)?"/);
});

test("render plans omit the optional profile track when no salesperson photo is supplied", () => {
  const plan = buildVerticalRenderPlan({ ...project, end_card_photo_url: "" }, importedVehicle());

  assert.ok(plan.render.timeline.tracks.every((track) => track.clips.length > 0));
  assert.equal(plan.render.timeline.tracks.length, 5);
});

test("production plans relay dealership images through the LotSocial source endpoint", () => {
  const plan = buildVerticalRenderPlan(project, importedVehicle(), "https://lotsocial.example/");
  const imageSources = plan.render.timeline.tracks.flatMap((track) => track.clips).filter((clip) => clip.asset.type === "image").map((clip) => clip.asset.src).filter(Boolean);
  assert.deepEqual([...new Set(imageSources)].sort(), [
    "https://lotsocial.example/api/render-source-images/project_1/0.jpg",
    "https://lotsocial.example/api/render-source-images/project_1/1.jpg",
  ]);
  assert.equal(imageSources.length, 4, "each relayed source is reused for foreground and wallpaper tracks");
});

test("production render sources use expiring signed URLs on the public media proxy", async () => {
  const urls = await buildSignedRenderSourceUrls(project, testEnv({
    LOTSOCIAL_RENDER_PROXY_ORIGIN: "https://lotsocial-render-source.bigjoe-ingram.workers.dev/",
    LOTSOCIAL_RENDER_PROXY_SECRET: "test-secret",
  }), 1_700_000_000_000);
  assert.equal(urls.length, 2);
  assert.match(urls[0], /^https:\/\/lotsocial-render-source\.bigjoe-ingram\.workers\.dev\/image\.jpg\?e=1700007200&u=[A-Za-z0-9_-]+&s=[A-Za-z0-9_-]+$/);
  assert.notEqual(urls[0], urls[1]);
  const plan = buildVerticalRenderPlan(project, importedVehicle(), urls);
  const imageSources = plan.render.timeline.tracks.flatMap((track) => track.clips).filter((clip) => clip.asset.type === "image").map((clip) => clip.asset.src).filter(Boolean);
  assert.deepEqual([...new Set(imageSources)].sort(), [...urls].sort());
});

test("the render source relay validates, caches, and serves the captured dealership image", async () => {
  const originalFetch = globalThis.fetch;
  const objects = new Map();
  const media = {
    get: async (key) => objects.get(key) ?? null,
    put: async (key, body, options) => objects.set(key, { body, size: body.byteLength, httpMetadata: options.httpMetadata }),
  };
  const db = new FakeD1({ creativeProjects: [project] });
  let upstreamFetches = 0;
  try {
    globalThis.fetch = async (url) => {
      upstreamFetches += 1;
      assert.equal(String(url), "https://dealer.example/photo.avif");
      return new Response(new Uint8Array([1, 2, 3]), { headers: { "Content-Type": "image/avif", "Content-Length": "3" } });
    };
    const env = testEnv({ DB: db, MEDIA: media });
    const first = await serveRenderSourceImage("00000000-0000-4000-8000-000000000001", "0", env);
    assert.equal(first.status, 404, "unknown projects fail closed");
    const served = await serveRenderSourceImage("project_1", "0", env);
    assert.equal(served.status, 404, "non-UUID project identifiers fail closed");

    const uuidProject = { ...project, id: "00000000-0000-4000-8000-000000000000" };
    db.creativeProjects.push(uuidProject);
    const fresh = await serveRenderSourceImage(uuidProject.id, "0.jpg", env);
    assert.equal(fresh.status, 200);
    assert.equal(fresh.headers.get("content-type"), "image/avif");
    const head = await serveRenderSourceImage(uuidProject.id, "0.jpg", env, true);
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("content-length"), "3");
    assert.equal(await head.text(), "");
    const cached = await serveRenderSourceImage(uuidProject.id, "0.jpg", env);
    assert.equal(cached.status, 200);
    assert.equal(upstreamFetches, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the stable render source falls back to the signed relay when the dealer CDN blocks Workers", async () => {
  const originalFetch = globalThis.fetch;
  const objects = new Map();
  const media = {
    get: async (key) => objects.get(key) ?? null,
    put: async (key, body, options) => objects.set(key, { body, size: body.byteLength, httpMetadata: options.httpMetadata }),
  };
  const uuidProject = { ...project, id: "00000000-0000-4000-8000-000000000002" };
  const db = new FakeD1({ creativeProjects: [uuidProject] });
  const requests = [];
  try {
    globalThis.fetch = async (url) => {
      requests.push(String(url));
      if (requests.length === 1) return new Response("blocked", { status: 403, headers: { "Content-Type": "text/html" } });
      assert.match(String(url), /^https:\/\/lotsocial-render-source\.bigjoe-ingram\.workers\.dev\/image\.jpg\?e=\d+&u=[A-Za-z0-9_-]+&s=[A-Za-z0-9_-]+$/);
      return new Response(new Uint8Array([4, 5, 6]), { headers: { "Content-Type": "image/jpeg", "Content-Length": "3" } });
    };
    const env = testEnv({
      DB: db,
      MEDIA: media,
      LOTSOCIAL_RENDER_PROXY_ORIGIN: "https://lotsocial-render-source.bigjoe-ingram.workers.dev/",
      LOTSOCIAL_RENDER_PROXY_SECRET: "test-secret",
    });
    const served = await serveRenderSourceImage(uuidProject.id, "0.jpg", env);
    assert.equal(served.status, 200);
    assert.equal(served.headers.get("content-type"), "image/jpeg");
    assert.equal(requests.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rendered end card uses a full-frame HTML5 grid with bounded rows and the approved content order", () => {
  const withPhoto = { ...project, end_card_photo_url: "https://app.example/api/profile-photos/00000000-0000-4000-8000-000000000000.jpg" };
  const plan = buildVerticalRenderPlan(withPhoto, importedVehicle({ imported_at: "2026-09-14 16:20:00" }));
  const endCard = plan.render.timeline.tracks[0].clips[0];
  const html = endCard.asset.html;
  const css = endCard.asset.css;
  assert.ok(plan.summary.endCardSeconds >= 5);
  assert.equal(endCard.asset.type, "html5");
  assert.equal(endCard.width, 720);
  assert.equal(endCard.height, 1280);
  assert.match(html, /<img class="profile-photo" src="https:\/\/app\.example\/api\/profile-photos\/00000000-0000-4000-8000-000000000000\.jpg"/);
  assert.match(css, /html,body\{box-sizing:border-box;width:720px;height:1280px/);
  assert.match(css, /\.content\{[^}]*display:grid;grid-template-rows:286px 106px 103px 93px 126px 1fr 60px/);
  assert.match(css, /\.profile-photo\{[^}]*object-fit:contain/);
  assert.doesNotMatch(css, /\.content\{[^}]*position:absolute/);
  assert.doesNotMatch(css, /\.brand\{[^}]*position:absolute/);
  assert.ok(html.indexOf("Joe") < html.indexOf("555-0100"));
  assert.ok(html.indexOf("555-0100") < html.indexOf("Message me for details"));
  assert.ok(html.indexOf("Message me for details") < html.indexOf("Pricing and availability"));
  assert.ok(html.indexOf("Pricing and availability") < html.indexOf("LotSocial"));
  assert.doesNotMatch(html, /2025 Ford/);
  assert.doesNotMatch(html, /<span>L<\/span><b>LotSocial/);
  assert.match(html, /<span><\/span><b>LotSocial/);
});

test("the private saved profile photo is embedded before the provider receives the HTML5 card", async () => {
  const photoId = "00000000-0000-4000-8000-000000000000.jpg";
  const withPhoto = { ...project, end_card_photo_url: `https://app.example/api/profile-photos/${photoId}` };
  const plan = buildVerticalRenderPlan(withPhoto, importedVehicle());
  const media = {
    get: async (key) => key === `profile-photos/${photoId}` ? {
      httpMetadata: { contentType: "image/jpeg" },
      arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
    } : null,
  };

  const compatible = await inlineRenderProfilePhotos(plan, testEnv({ MEDIA: media }));
  const originalHtml = plan.render.timeline.tracks[0].clips[0].asset.html;
  const providerHtml = compatible.render.timeline.tracks[0].clips[0].asset.html;
  assert.match(originalHtml, /https:\/\/app\.example\/api\/profile-photos\//, "the stored audit plan keeps the stable application URL");
  assert.doesNotMatch(providerHtml, /\/api\/profile-photos\//);
  assert.match(providerHtml, /src="data:image\/jpeg;base64,AQID"/);
});

test("a missing saved profile photo fails before a paid render can be submitted", async () => {
  const withPhoto = { ...project, end_card_photo_url: "https://app.example/api/profile-photos/00000000-0000-4000-8000-000000000000.jpg" };
  const plan = buildVerticalRenderPlan(withPhoto, importedVehicle());
  await assert.rejects(
    () => inlineRenderProfilePhotos(plan, testEnv({ MEDIA: { get: async () => null } })),
    /No render was submitted or charged/,
  );
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

test("failed-render recovery can convert every image format once before retrying", async () => {
  const originalFetch = globalThis.fetch;
  let ingestPosts = 0;
  try {
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      if (url.endsWith("/sources") && init.method === "POST") {
        ingestPosts += 1;
        return Response.json({ data: { id: `source_${ingestPosts}` } }, { status: 201 });
      }
      if (url.includes("/sources/source_")) {
        const sourceId = url.match(/source_\d+$/)?.[0];
        return Response.json({ data: { attributes: { status: "ready", outputs: { renditions: [{ status: "ready", url: `https://shotstack.example/${sourceId}.jpg` }] } } } });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };
    const jpegProject = { ...project, selected_images: JSON.stringify(["https://dealer.example/photo.jpg"]) };
    const plan = buildVerticalRenderPlan(jpegProject, importedVehicle());
    const compatible = await prepareRenderCompatibleImages(plan, "test-key", "stage", true);
    const imageSources = compatible.render.timeline.tracks.flatMap((track) => track.clips).map((clip) => clip.asset.src).filter(Boolean);
    assert.equal(ingestPosts, 1, "the duplicated foreground and wallpaper source is ingested once");
    assert.equal(imageSources.filter((src) => src === "https://shotstack.example/source_1.jpg").length, 2);
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

test("failed renderer status extracts nested and array messages", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (input) => {
      assert.match(String(input), /\?data=true&merged=true$/);
      return Response.json({ response: { status: "failed", error: [{ details: { reason: "Audio track is invalid" } }] } });
    };
    const result = await checkRender("v1:render_1", testEnv({ SHOTSTACK_API_KEY: "test-key" }));
    assert.equal(result.status, "failed");
    assert.equal(result.errorMessage, "Audio track is invalid");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
