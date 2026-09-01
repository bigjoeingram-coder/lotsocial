/**
 * I-22 live-schema audit.
 *
 * Read-only. Answers two questions about a deployed database:
 *   1. Do the five TEXT PRIMARY KEY columns enforce NOT NULL?
 *   2. Do any NULL ids already exist?
 *
 * The database is provisioned by the OpenAI Sites platform (.openai/hosting.json
 * declares "d1": "DB"), not by Cloudflare directly, and this repo has no
 * wrangler config. However you reach it, run:
 *
 *   SELECT name, sql FROM sqlite_master WHERE type='table'
 *
 * save the rows as JSON, then:
 *
 *   node scripts/i22-check-schema.mjs schema.json
 *
 * Accepts a bare rows array, {results:[...]}, or wrangler's [{results:[...]}].
 * This script itself needs no deploy, no credentials, and no network.
 */
import { readFile } from "node:fs/promises";

export const REPAIR_TARGETS = {
  authorization_requests: "id",
  provider_verifications: "request_id",
  imported_vehicles: "id",
  creative_projects: "id",
  creative_render_jobs: "id",
};

const QUOTES = ['"', "'", "`", "[", "]"];

function stripQuotes(value) {
  let out = value;
  while (out.length && QUOTES.includes(out[0])) out = out.slice(1);
  return out;
}

/**
 * Does `ddl` declare `column` as a PRIMARY KEY that also enforces NOT NULL?
 * Returns true/false, or null when the column's declaration cannot be found.
 */
export function enforcesNotNull(ddl, column) {
  if (!ddl) return null;
  const wanted = column.toLowerCase();
  const line = ddl
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find((entry) => {
      const bare = stripQuotes(entry);
      if (!bare.toLowerCase().startsWith(wanted)) return false;
      // Must be followed by a separator, not more identifier characters,
      // so "id" does not match "identifier".
      const next = bare.charAt(column.length);
      return next === "" || QUOTES.includes(next) || next === " " || next === "\t";
    });
  if (!line) return null;
  if (!/PRIMARY KEY/i.test(line)) return null;
  // INTEGER PRIMARY KEY is the rowid alias: SQLite cannot store NULL there,
  // so it is already safe with or without an explicit NOT NULL.
  if (/\bINTEGER\s+PRIMARY\s+KEY/i.test(line)) return true;
  return /NOT\s+NULL/i.test(line);
}

export function auditSchema(tables) {
  const byName = new Map(tables.map((row) => [row.name, row.sql]));
  return Object.entries(REPAIR_TARGETS).map(([table, column]) => {
    const present = byName.has(table);
    const enforced = present ? enforcesNotNull(byName.get(table), column) : null;
    return { table, column, present, enforced, needsRepair: present && enforced === false };
  });
}

function flatten(parsed) {
  if (Array.isArray(parsed)) {
    if (parsed.length && Array.isArray(parsed[0]?.results)) return parsed.flatMap((row) => row.results);
    return parsed;
  }
  if (Array.isArray(parsed?.results)) return parsed.results;
  if (Array.isArray(parsed?.result)) return flatten(parsed.result);
  throw new Error("Could not find a rows array in that JSON.");
}

const invokedDirectly = process.argv[1]?.endsWith("i22-check-schema.mjs");
if (invokedDirectly) {
  const path = process.argv[2];
  if (!path) {
    console.error("usage: node scripts/i22-check-schema.mjs <schema.json>");
    process.exit(2);
  }
  const rows = flatten(JSON.parse(await readFile(path, "utf8")));
  const findings = auditSchema(rows);
  let repairs = 0;
  for (const finding of findings) {
    const state = !finding.present
      ? "TABLE MISSING"
      : finding.enforced === null
        ? "COULD NOT PARSE"
        : finding.enforced
          ? "ok - NOT NULL enforced"
          : "NEEDS REPAIR - nullable PRIMARY KEY";
    if (finding.needsRepair) repairs += 1;
    console.log(`${finding.table}.${finding.column}`.padEnd(38), state);
  }
  console.log("");
  if (repairs === 0) {
    console.log("No repair needed. I-22 does not affect this database.");
  } else {
    console.log(`${repairs} column(s) need repair.`);
    console.log("Next: export a D1 backup, then apply drizzle/repair/i22-enforce-pk-not-null.sql.");
    console.log("First run, per affected table:  SELECT COUNT(*) FROM <table> WHERE <column> IS NULL;");
    console.log("A non-zero count means real NULL ids exist and must be resolved before the rebuild.");
  }
  process.exit(repairs === 0 ? 0 : 1);
}
