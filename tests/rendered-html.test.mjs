import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, projectRoot), "utf8");
}

test("ships the LotSocial product instead of the disposable starter", async () => {
  const [page, layout, packageJson] = await Promise.all([
    source("app/page.tsx"),
    source("app/layout.tsx"),
    source("package.json"),
  ]);

  assert.match(page, /AuthorizationApp/);
  assert.match(layout, /LotSocial Inventory Authorization/);
  assert.doesNotMatch(page, /SkeletonPreview|codex-preview/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  assert.deepEqual(await readdir(new URL("app/_sites-preview", projectRoot)), []);
});

test("includes the mobile Add to Home Screen pilot banner", async () => {
  const [component, css] = await Promise.all([
    source("app/components/AuthorizationApp.tsx"),
    source("app/globals.css"),
  ]);

  assert.match(component, /lotsocial-install-banner-dismissed/);
  assert.match(component, /Add LotSocial to your home screen/);
  assert.match(component, />iPhone</);
  assert.match(component, />Android</);
  assert.match(component, /open this page in Safari/);
  assert.match(component, /setInstallHelp\(installHelp === "ios" \? null : "ios"\)/);
  assert.match(component, /setInstallHelp\(installHelp === "android" \? null : "android"\)/);
  assert.match(css, /\.install-banner/);
  assert.match(css, /\.install-steps/);
});

test("opens and saves a source-stamped manual vehicle fallback", async () => {
  const [component, route, vdp] = await Promise.all([
    source("app/components/AuthorizationApp.tsx"),
    source("app/api/vdp-imports/route.ts"),
    source("app/lib/vdp.ts"),
  ]);

  assert.match(component, /setManualFallbackOpen\(true\)/);
  assert.match(component, /Add the essentials and keep going/);
  assert.match(component, /Save manual vehicle/);
  assert.match(route, /createManualVehicle/);
  assert.match(route, /payload\.authorizedToMarket !== true/);
  assert.match(vdp, /export function createManualVehicle/);
  assert.match(vdp, /if \(!year \|\| !make \|\| !model\)/);
  assert.match(vdp, /sourceUrl: source\.href/);
});

test("uses a browser-like request signature for public VDP reads", async () => {
  const vdp = await source("app/lib/vdp.ts");

  assert.match(vdp, /Mozilla\/5\.0/);
  assert.match(vdp, /Accept-Language/);
  assert.match(vdp, /Cache-Control/);
  assert.match(vdp, /Referer: requestedUrl\.origin/);
});
