// Rock 6 — real extractor tests (I-07, I-18).
// Every fixture is inline and offline: no network, no Bright Data, no reader.
import assert from "node:assert/strict";
import test from "node:test";
import {
  candidateInventoryPaths,
  isCloudflareChallenge,
  normalizeListedPrice,
  parseDealerInspireMarkdown,
  parseVehicleHtml,
  slugMakeAndModel,
  vehicleBlockBounds,
  vinFromUrl,
} from "../app/lib/vdp.ts";

const VIN_A = "1FTFW1E80PFA12345";
const VIN_B = "1FTFW1E80PFB67890";

// ---------- fixtures ----------

const jsonLdVdp = `<!doctype html><html><head>
<title>New 2025 Ford F-150 XLT | Freeway Ford</title>
<meta property="og:title" content="New 2025 Ford F-150 XLT">
<meta property="og:site_name" content="Freeway Ford">
<meta property="og:image" content="/photos/f150-hero.jpg">
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Vehicle","name":"New 2025 Ford F-150 XLT SuperCrew",
 "vehicleIdentificationNumber":"${VIN_A}","sku":"F25-0042","vehicleModelDate":"2025",
 "brand":{"@type":"Brand","name":"Ford"},"model":"F-150","vehicleConfiguration":"XLT SuperCrew",
 "color":"Antimatter Blue","vehicleInteriorColor":"Black","vehicleTransmission":"Automatic",
 "fuelType":"Gasoline","driveWheelConfiguration":"4WD","bodyType":"Pickup",
 "image":["https://cdn.example/f150-1.jpg","https://cdn.example/f150-2.jpg"],
 "offers":{"@type":"Offer","price":"58995","priceCurrency":"USD","seller":{"@type":"AutoDealer","name":"Freeway Ford"}}}
</script></head><body><h1>2025 Ford F-150 XLT</h1><span>Stock #: F25-0042</span></body></html>`;

const metaOnlyVdp = `<!doctype html><html><head>
<title>Used 2022 Jeep Grand Cherokee Limited for Sale | Crown Dodge</title>
<meta property="og:title" content="Used 2022 Jeep Grand Cherokee Limited">
<meta property="og:site_name" content="Crown Dodge">
<meta property="product:price:amount" content="34,750">
<meta name="description" content="One-owner 2022 Jeep Grand Cherokee Limited, 4x4, heated seats.">
</head><body>
<div class="vehicle-gallery"><img src="/img/gc-1.jpg" alt="vehicle photo"><img data-src="/img/gc-2.jpg" alt="vehicle photo"></div>
<p>VIN: 1C4RJHBG5N8123456</p><p>Stock # C22-118</p><p>Internet Price: $34,750</p>
</body></html>`;

const cloudflareChallenge = `<!doctype html><html><head><title>Just a moment...</title>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script></head>
<body><div id="cf-chl-widget">Checking if the site connection is secure</div></body></html>`;

// A Dealer Inspire inventory page rendered to markdown: two trucks back to back.
// Vehicle A (the one we asked for) has NO price on the listing. Vehicle B, immediately
// after it, has a price. The old 5000-character window read B's price as A's.
const twoVehicleListing = `Title: New Ford F-150 Inventory | Freeway Ford
URL Source: https://www.freewayford.example/new-vehicles/f-150/
Markdown Content:
## [New 2025 Ford F-150 XLT](https://www.freewayford.example/new-2025-ford-f150-xlt-${VIN_A}/)
![Vehicle A](https://cdn.example/a-1.jpg)
Exterior: Oxford White
Interior: Medium Dark Slate
Location: Freeway Ford
VIN: ${VIN_A} STOCK: F25-0001
Mileage: 12
Call for price

## [New 2025 Ford F-150 Lariat](https://www.freewayford.example/new-2025-ford-f150-lariat-${VIN_B}/)
![Vehicle B](https://cdn.example/b-1.jpg)
Exterior: Agate Black
Interior: Black
Location: Freeway Ford
VIN: ${VIN_B} STOCK: F25-0002
Mileage: 8
Sale Price: $64,120
`;

const vinlessUrlVdpMarkdown = `Title: New 2026 Ford Super Duty F-250 SRW XL Truck Oxford White For Sale | Stock: TEC22448
URL Source: https://www.freewayford.example/new/Ford/2026-Ford-Super-Duty-F-250-SRW-fresno-CA-page-id.htm
Markdown Content:
![Image 1: 2026 Ford Super Duty F-250 SRW XL](https://cdn.example/f250-1.jpg)
2026 Ford Super Duty F-250 SRW XL
## 2026 Ford Super Duty F-250 SRW XL
$71,590 MSRP
$69,675 Net Sale Price
MSRP 1$71,590 Doc Fee$85 Selling Price$71,675 Retail Customer Cash-$2,000 Net Sale Price$69,675
### The overview
Exterior Color Oxford White Interior Color Medium Dark Slate Transmission Automatic Drivetrain 4WD
Engine 6.7L 8 Cylinder Engine VIN 1FT8W2BT7TEC22448 Stock Number TEC22448
`;

// ---------- JSON-LD ----------

test("JSON-LD VDP: every field comes from the structured node", async () => {
  const vehicle = await parseVehicleHtml(jsonLdVdp, new URL("https://www.freewayford.example/new-2025-ford-f150-xlt/"));
  assert.equal(vehicle.vin, VIN_A);
  assert.equal(vehicle.year, "2025");
  assert.equal(vehicle.make, "Ford");
  assert.equal(vehicle.model, "F-150");
  assert.equal(vehicle.trim, "XLT SuperCrew");
  assert.equal(vehicle.price, "58995");
  assert.equal(vehicle.currency, "USD");
  assert.equal(vehicle.stockNumber, "F25-0042");
  assert.equal(vehicle.facts.dealershipName, "Freeway Ford");
  assert.equal(vehicle.facts.exteriorColor, "Antimatter Blue");
  assert.equal(vehicle.facts.drivetrain, "4WD");
  assert.deepEqual(vehicle.imageUrls.slice(0, 2), ["https://cdn.example/f150-1.jpg", "https://cdn.example/f150-2.jpg"]);
  assert.equal(vehicle.imageUrls.includes("https://www.freewayford.example/photos/f150-hero.jpg"), true);
});

// ---------- meta / regex only ----------

test("meta-only VDP (no JSON-LD): title, price, VIN and stock come from meta tags and visible text", async () => {
  const vehicle = await parseVehicleHtml(metaOnlyVdp, new URL("https://www.crowndodge.example/used-2022-jeep-grand-cherokee-limited/"));
  assert.equal(vehicle.title, "Used 2022 Jeep Grand Cherokee Limited");
  assert.equal(vehicle.vin, "1C4RJHBG5N8123456");
  assert.equal(vehicle.year, "2022");
  assert.equal(vehicle.price, "34750");
  assert.equal(vehicle.stockNumber, "C22-118");
  assert.equal(vehicle.facts.dealershipName, "Crown Dodge");
  assert.equal(vehicle.description.startsWith("One-owner 2022 Jeep"), true);
  assert.deepEqual(vehicle.imageUrls, ["https://www.crowndodge.example/img/gc-1.jpg", "https://www.crowndodge.example/img/gc-2.jpg"]);
});

test("a page with no vehicle evidence is refused, never saved as 'Imported vehicle'", async () => {
  await assert.rejects(
    () => parseVehicleHtml("<html><head><title>Welcome</title></head><body>Hours and directions</body></html>", new URL("https://dealer.example/about/")),
    /could not confirm a specific vehicle/,
  );
});

test("an inventory listing page is refused with the 'open the exact VDP' message", async () => {
  const html = `<html><head><title>New Vehicles for Sale in Fullerton | 42 matches</title></head><body>VIN: ${VIN_A}</body></html>`;
  await assert.rejects(() => parseVehicleHtml(html, new URL("https://dealer.example/new-vehicles/")), /inventory listing page/);
});

// ---------- Cloudflare challenge ----------

test("Cloudflare challenge page is detected as blocked, not parsed as a vehicle", () => {
  assert.equal(isCloudflareChallenge(cloudflareChallenge), true);
  assert.equal(isCloudflareChallenge(cloudflareChallenge, new Headers({ "cf-mitigated": "challenge" })), true);
  assert.equal(isCloudflareChallenge(jsonLdVdp), false);
  assert.equal(isCloudflareChallenge(jsonLdVdp, new Headers({ server: "cloudflare" })), true, "a cloudflare server header alone is treated as a challenge signal");
});

test("Cloudflare challenge rendered through the reader is rejected by the listing parser", () => {
  const markdown = `Title: Just a moment...\nURL Source: https://dealer.example/x\nMarkdown Content:\nChecking if the site connection is secure\nVIN: ${VIN_A}`;
  assert.equal(parseDealerInspireMarkdown(markdown, new URL(`https://dealer.example/new-2025-ford-f150-${VIN_A}/`)), null);
});

test("an exact reader-rendered VDP may recover its sole VIN when the dealer URL omits it", () => {
  const sourceUrl = new URL("https://www.freewayford.example/new/Ford/2026-Ford-Super-Duty-F-250-SRW-fresno-CA-page-id.htm");
  const vehicle = parseDealerInspireMarkdown(vinlessUrlVdpMarkdown, sourceUrl, sourceUrl);
  assert.ok(vehicle);
  assert.equal(vehicle.vin, "1FT8W2BT7TEC22448");
  assert.equal(vehicle.title, "2026 Ford Super Duty F-250 SRW XL");
  assert.equal(vehicle.price, "69675");
  assert.equal(vehicle.stockNumber, "TEC22448");
  assert.deepEqual(vehicle.imageUrls, ["https://cdn.example/f250-1.jpg"]);
});

test("VIN recovery is refused on fallback inventory surfaces or ambiguous pages", () => {
  const sourceUrl = new URL("https://www.freewayford.example/new/Ford/2026-Ford-Super-Duty-F-250-SRW-fresno-CA-page-id.htm");
  const inventoryUrl = new URL("https://www.freewayford.example/new-vehicles/");
  assert.equal(parseDealerInspireMarkdown(vinlessUrlVdpMarkdown, sourceUrl, inventoryUrl), null);
  assert.equal(parseDealerInspireMarkdown(`${vinlessUrlVdpMarkdown}\nVIN: ${VIN_B}`, sourceUrl, sourceUrl), null);
});

// ---------- the wrong-neighbor price bug (I-07) ----------

test("vehicle block bounds stop at the next vehicle heading", () => {
  const vinIndex = twoVehicleListing.indexOf(`VIN: ${VIN_A}`);
  const { start, end } = vehicleBlockBounds(twoVehicleListing, vinIndex);
  const block = twoVehicleListing.slice(start, end);
  assert.equal(block.startsWith("## [New 2025 Ford F-150 XLT]"), true, "block starts at the matched vehicle's own heading");
  assert.equal(block.includes(VIN_B), false, "block never reaches into the neighbor");
  assert.equal(block.includes("64,120"), false);
});

test("two adjacent vehicles: the matched vehicle's price is empty, NEVER the neighbor's", () => {
  const vehicleA = parseDealerInspireMarkdown(twoVehicleListing, new URL(`https://www.freewayford.example/new-2025-ford-f150-xlt-${VIN_A}/`));
  assert.ok(vehicleA, "vehicle A is found by VIN");
  assert.equal(vehicleA.vin, VIN_A);
  assert.equal(vehicleA.title, "New 2025 Ford F-150 XLT");
  assert.equal(vehicleA.stockNumber, "F25-0001");
  assert.equal(vehicleA.price, "", "no price on A's block means empty, not B's $64,120");
  assert.equal(vehicleA.facts.exteriorColor, "Oxford White");
  assert.equal(vehicleA.facts.mileage, "12");
  assert.deepEqual(vehicleA.imageUrls, ["https://cdn.example/a-1.jpg"], "images are A's only");
});

test("two adjacent vehicles: the second vehicle still resolves its own price and fields", () => {
  const vehicleB = parseDealerInspireMarkdown(twoVehicleListing, new URL(`https://www.freewayford.example/new-2025-ford-f150-lariat-${VIN_B}/`));
  assert.ok(vehicleB);
  assert.equal(vehicleB.vin, VIN_B);
  assert.equal(vehicleB.title, "New 2025 Ford F-150 Lariat");
  assert.equal(vehicleB.price, "64120");
  assert.equal(vehicleB.stockNumber, "F25-0002");
  assert.equal(vehicleB.facts.exteriorColor, "Agate Black");
  assert.deepEqual(vehicleB.imageUrls, ["https://cdn.example/b-1.jpg"]);
});

test("a single-vehicle block keeps the old wide window (no heading, no neighbor)", () => {
  const single = `Markdown Content:\nSome page chrome\nVIN: ${VIN_A} STOCK: Z1\nSale Price: $41,000\n`;
  const vinIndex = single.indexOf("VIN:");
  const { start, end } = vehicleBlockBounds(single, vinIndex);
  assert.equal(start, 0);
  assert.equal(end, single.length);
});

// ---------- URLs, slugs and the allowlist removal (I-18) ----------

test("VIN is lifted from the URL path", () => {
  assert.equal(vinFromUrl(new URL(`https://dealer.example/new-2025-ford-f150-${VIN_A.toLowerCase()}/`)), VIN_A);
  assert.equal(vinFromUrl(new URL("https://dealer.example/new-2025-ford-f150/")), "");
});

test("slug heuristic finds make and model without an allowlist", () => {
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/new-2025-ram-1500-big-horn-1C6SRFBT5SN123456/")), { make: "ram", model: "1500" });
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/used-2022-jeep-grand-cherokee-limited/")), { make: "jeep", model: "grand" });
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/new-2025-chrysler-pacifica-touring/")), { make: "chrysler", model: "pacifica" });
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/inventory/new-2024-dodge-hornet-gt/")), { make: "dodge", model: "hornet" });
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/new-2025-lexus-rx-350-premium/")), { make: "lexus", model: "rx" });
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/new-2025-land-rover-defender-110/")), { make: "land-rover", model: "defender" });
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/certified-pre-owned-2023-mercedes-benz-gle-350/")), { make: "mercedes-benz", model: "gle" });
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/used-2024-mini-cooper-s-hardtop/")), { make: "mini", model: "cooper" });
});

test("slug heuristic without a year still finds the make and model", () => {
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/used-toyota-tacoma-trd/")), { make: "toyota", model: "tacoma" });
});

test("slug heuristic never treats a VIN or nothing as a model", () => {
  assert.deepEqual(slugMakeAndModel(new URL(`https://dealer.example/new-2025-ram-${VIN_A}/`)), { make: "ram", model: "" });
  assert.deepEqual(slugMakeAndModel(new URL("https://dealer.example/vdp/12345/")), { make: "", model: "" });
});

test("a Ram or Jeep URL still generates candidate inventory paths (was silently skipped by the 23-make list)", () => {
  const ram = candidateInventoryPaths(new URL("https://dealer.example/new-2025-ram-1500-big-horn-1C6SRFBT5SN123456/")).map((url) => url.pathname + url.search);
  assert.equal(ram.includes("/inventory/?q=1C6SRFBT5SN123456"), true);
  assert.equal(ram.includes("/new-vehicles/1500/"), true, "model path is present for Ram");
  const jeep = candidateInventoryPaths(new URL("https://dealer.example/used-2022-jeep-grand-cherokee-limited/")).map((url) => url.pathname);
  assert.equal(jeep.includes("/new-vehicles/grand/"), true, "model path is present for Jeep");
  assert.equal(jeep.includes("/used-vehicles/"), true);
});

test("a no-VIN URL still yields the generic inventory surfaces, in a stable order", () => {
  const paths = candidateInventoryPaths(new URL("https://dealer.example/vdp/12345/")).map((url) => url.pathname);
  assert.deepEqual(paths, ["/llm/inventory/", "/new-vehicles/crossovers-suvs/", "/new-vehicles/suvs/", "/new-vehicles/", "/used-vehicles/"]);
});

// ---------- price normalization ----------

test("listed price normalization keeps real prices and drops junk", () => {
  assert.equal(normalizeListedPrice("$58,995"), "58995");
  assert.equal(normalizeListedPrice("USD 34750.00"), "34750");
  assert.equal(normalizeListedPrice("$499"), "", "sub-$1,000 values are not vehicle prices");
  assert.equal(normalizeListedPrice("Call for price"), "");
  assert.equal(normalizeListedPrice(undefined), "");
});
