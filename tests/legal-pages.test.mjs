import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { LEGAL_ACCURACY_URL, LEGAL_DOCUMENTS, LEGAL_VERSIONS } from "../app/legal/generated-content.ts";
import { PRICING_DISCLAIMER_VERSION, TERMS_VERSION } from "../app/lib/evidence.ts";

const canonicalRoutes = [
  ["app/legal/page.tsx", "/legal"],
  ["app/legal/terms/page.tsx", "/legal/terms"],
  ["app/legal/privacy/page.tsx", "/legal/privacy"],
  ["app/legal/accuracy/page.tsx", "/legal/accuracy"],
  ["app/legal/fraud-awareness/page.tsx", "/legal/fraud-awareness"],
  ["app/legal/authorization/page.tsx", "/legal/authorization"],
  ["app/legal/report/page.tsx", "/legal/report"],
];

test("versioned frontmatter generates every canonical legal document", async () => {
  const sourceFiles = (await readdir("content/legal")).filter((name) => name.endsWith("-v0.9.md"));
  assert.equal(sourceFiles.length, 6);
  assert.equal(TERMS_VERSION, "2026-09-28-v0.9");
  assert.equal(PRICING_DISCLAIMER_VERSION, "2026-09-28-v0.9");
  assert.equal(LEGAL_VERSIONS.termsVersion, TERMS_VERSION);
  assert.equal(LEGAL_VERSIONS.disclaimerVersion, PRICING_DISCLAIMER_VERSION);
  assert.equal(LEGAL_ACCURACY_URL, "https://lotsocial-authorization.salesgenius.chatgpt.site/legal/accuracy");
  for (const document of Object.values(LEGAL_DOCUMENTS)) {
    assert.equal(document.versionLabel, "v0.9 — counsel review pending");
    assert.ok(document.body.length > 300, `${document.id} should not be empty`);
    assert.doesNotMatch(document.body, /\bTBD\b|\bTODO\b|placeholder/i);
  }
});

test("canonical routes, legacy aliases, legal navigation, and the global footer are wired", async () => {
  for (const [file] of canonicalRoutes) assert.ok((await readFile(file, "utf8")).includes("Legal"), `${file} should render the legal system`);
  assert.match(await readFile("app/terms/page.tsx", "utf8"), /legal\/terms\/page/);
  assert.match(await readFile("app/privacy/page.tsx", "utf8"), /legal\/privacy\/page/);
  const shell = await readFile("app/legal/LegalShell.tsx", "utf8");
  const layout = await readFile("app/layout.tsx", "utf8");
  for (const [, route] of canonicalRoutes) {
    assert.ok(shell.includes(route) || route === "/legal", `legal nav should include ${route}`);
    assert.ok(layout.includes(`href="${route}"`), `footer should include ${route}`);
  }
  const app = await readFile("app/components/AuthorizationApp.tsx", "utf8");
  assert.match(app, /href="\/legal">Legal</);
  assert.match(app, /href="\/legal\/accuracy">Accuracy and listing limitations/);
});

test("the report page supplies safe routing without inventing a LotSocial destination", () => {
  const report = LEGAL_DOCUMENTS.report.body;
  assert.match(report, /verified business or support channel that issued your access/i);
  assert.match(report, /official website/i);
  assert.doesNotMatch(report, /mailto:|@lotsocial|support@/i);
});
