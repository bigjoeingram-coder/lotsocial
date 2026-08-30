import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_BOOTSTRAP_SQL } from "../app/lib/schema-bootstrap.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const drizzleDir = join(repoRoot, "drizzle");

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function normalizeDefault(value) {
  return value == null ? null : String(value).trim().replace(/\s+/g, " ");
}

function normalizeType(value) {
  return String(value ?? "").trim().toUpperCase();
}

function migrationStatements(sql) {
  return sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function applyStatements(db, statements) {
  for (const statement of statements) {
    db.exec(statement);
  }
}

function sortedJson(value) {
  return JSON.stringify(value, null, 2);
}

function readCatalog(db) {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);

  return tables.map((tableName) => ({
    name: tableName,
    columns: db
      .prepare(`PRAGMA table_info(${quoteIdentifier(tableName)})`)
      .all()
      .map((column) => ({
        name: column.name,
        type: normalizeType(column.type),
        notnull: Number(column.notnull),
        default: normalizeDefault(column.dflt_value),
        pk: Number(column.pk),
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    indexes: db
      .prepare(`PRAGMA index_list(${quoteIdentifier(tableName)})`)
      .all()
      .filter((index) => index.origin !== "pk")
      .map((index) => ({
        unique: Number(index.unique),
        partial: Number(index.partial),
        columns: db
          .prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
          .all()
          .map((column) => column.name)
          .filter(Boolean),
      }))
      .sort((left, right) => sortedJson(left).localeCompare(sortedJson(right))),
  }));
}

function keyedByName(items) {
  return new Map(items.map((item) => [item.name, item]));
}

function setDifference(left, right) {
  return [...left].filter((item) => !right.has(item));
}

function diffCatalogs(bootstrapCatalog, migrationCatalog) {
  const differences = [];
  const bootstrapTables = keyedByName(bootstrapCatalog);
  const migrationTables = keyedByName(migrationCatalog);
  const bootstrapNames = new Set(bootstrapTables.keys());
  const migrationNames = new Set(migrationTables.keys());

  for (const tableName of setDifference(migrationNames, bootstrapNames)) {
    differences.push(`Table missing from bootstrap: ${tableName}`);
  }
  for (const tableName of setDifference(bootstrapNames, migrationNames)) {
    differences.push(`Table only in bootstrap: ${tableName}`);
  }

  for (const tableName of [...migrationNames].filter((name) => bootstrapNames.has(name)).sort()) {
    const bootstrapTable = bootstrapTables.get(tableName);
    const migrationTable = migrationTables.get(tableName);
    const bootstrapColumns = keyedByName(bootstrapTable.columns);
    const migrationColumns = keyedByName(migrationTable.columns);
    const bootstrapColumnNames = new Set(bootstrapColumns.keys());
    const migrationColumnNames = new Set(migrationColumns.keys());

    for (const columnName of setDifference(migrationColumnNames, bootstrapColumnNames)) {
      differences.push(`Column missing from bootstrap: ${tableName}.${columnName}`);
    }
    for (const columnName of setDifference(bootstrapColumnNames, migrationColumnNames)) {
      differences.push(`Column only in bootstrap: ${tableName}.${columnName}`);
    }

    for (const columnName of [...migrationColumnNames].filter((name) => bootstrapColumnNames.has(name)).sort()) {
      const bootstrapColumn = bootstrapColumns.get(columnName);
      const migrationColumn = migrationColumns.get(columnName);
      if (sortedJson(bootstrapColumn) !== sortedJson(migrationColumn)) {
        differences.push(
          `Column differs: ${tableName}.${columnName}\n` +
            `  bootstrap: ${sortedJson(bootstrapColumn)}\n` +
            `  migrations: ${sortedJson(migrationColumn)}`,
        );
      }
    }

    const bootstrapIndexes = bootstrapTable.indexes.map(sortedJson).sort();
    const migrationIndexes = migrationTable.indexes.map(sortedJson).sort();
    if (sortedJson(bootstrapIndexes) !== sortedJson(migrationIndexes)) {
      differences.push(
        `Indexes differ: ${tableName}\n` +
          `  bootstrap: ${sortedJson(bootstrapTable.indexes)}\n` +
          `  migrations: ${sortedJson(migrationTable.indexes)}`,
      );
    }
  }

  return differences;
}

async function drizzleMigrationStatements() {
  const journalPath = join(drizzleDir, "meta", "_journal.json");
  const journal = JSON.parse(await readFile(journalPath, "utf8"));
  const entries = [...journal.entries].sort((left, right) => left.idx - right.idx);
  const statements = [];

  for (const entry of entries) {
    const migrationSql = await readFile(join(drizzleDir, `${entry.tag}.sql`), "utf8");
    statements.push(...migrationStatements(migrationSql));
  }

  return statements;
}

const bootstrapDb = new DatabaseSync(":memory:");
const migrationsDb = new DatabaseSync(":memory:");

applyStatements(bootstrapDb, SCHEMA_BOOTSTRAP_SQL);
applyStatements(migrationsDb, await drizzleMigrationStatements());

const differences = diffCatalogs(readCatalog(bootstrapDb), readCatalog(migrationsDb));

bootstrapDb.close();
migrationsDb.close();

if (differences.length > 0) {
  console.error("Bootstrap schema does not match Drizzle migrations.");
  console.error(differences.join("\n"));
  process.exit(1);
}

console.log("Bootstrap schema matches Drizzle migrations.");
