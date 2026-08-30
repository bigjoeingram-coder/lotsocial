import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const drizzleDir = join(root, "drizzle");

async function snapshotDirectory(directory) {
  const entries = new Map();

  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else if (entry.isFile()) {
        const content = await readFile(path);
        entries.set(relative(directory, path).replaceAll("\\", "/"), {
          content,
          hash: createHash("sha256").update(content).digest("hex"),
        });
      }
    }
  }

  await walk(directory);
  return entries;
}

function diffSnapshots(before, after) {
  const paths = new Set([...before.keys(), ...after.keys()]);
  return Array.from(paths).sort().filter((path) => before.get(path)?.hash !== after.get(path)?.hash);
}

async function restoreSnapshot(directory, before, after) {
  for (const path of after.keys()) {
    if (!before.has(path)) await rm(join(directory, path), { force: true });
  }
  for (const [path, entry] of before) {
    const target = join(directory, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.content);
  }
}

function runDrizzleGenerate() {
  const bin = join(root, "node_modules", "drizzle-kit", "bin.cjs");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, "generate"], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`drizzle-kit generate exited with code ${code ?? "unknown"}`));
    });
  });
}

const before = await snapshotDirectory(drizzleDir);
await runDrizzleGenerate();
const after = await snapshotDirectory(drizzleDir);
const changed = diffSnapshots(before, after);

if (changed.length) {
  await restoreSnapshot(drizzleDir, before, after);
  console.error("Drizzle schema drift detected. `drizzle-kit generate` changed:");
  for (const path of changed) console.error(`- drizzle/${path}`);
  console.error("Commit the generated migration/snapshot changes, or revert the schema edit.");
  process.exit(1);
}

console.log("Drizzle schema drift check passed: generated migrations match db/schema.ts.");
