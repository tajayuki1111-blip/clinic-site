import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function runBuild(fixture) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["build.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        MICROCMS_API_KEY: "",
        MICROCMS_FIXTURE_FILE: fixture
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => resolve({ code, stderr }));
  });
}

const valid = await runBuild("test/fixtures/microcms.json");
if (valid.code !== 0) {
  throw new Error(`Valid fixture failed:\n${valid.stderr}`);
}

const manifestPath = path.join(root, "_site", "deployment-manifest.json");
const before = await readFile(manifestPath, "utf8");
const invalid = await runBuild("test/fixtures/invalid-microcms.json");
const after = await readFile(manifestPath, "utf8");

if (invalid.code === 0) {
  throw new Error("Invalid microCMS fixture unexpectedly passed.");
}
if (!invalid.stderr.includes("contents must be an array")) {
  throw new Error(`Invalid fixture failed for the wrong reason:\n${invalid.stderr}`);
}
if (before !== after) {
  throw new Error("A rejected microCMS response changed the existing output.");
}

console.log("Build safety test passed.");
