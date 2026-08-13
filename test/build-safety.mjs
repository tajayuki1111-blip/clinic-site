import { execFile, spawn } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const root = path.resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

function runBuild(fixture) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["build.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        MICROCMS_API_KEY: "",
        MICROCMS_FIXTURE_FILE: fixture,
        REQUIRE_COMPLETE_GIT_HISTORY: "true"
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

const workflow = await readFile(
  path.join(root, ".github", "workflows", "pages.yml"),
  "utf8"
);
const firstCheckoutStep = workflow.match(
  /- name: Checkout[\s\S]*?(?=\n\s{6}- name:)/
)?.[0] || "";
const fixtureBuildStep = workflow.match(
  /- name: Build static site from fixture[\s\S]*?(?=\n\s{6}- name:)/
)?.[0] || "";
const productionBuildStep = workflow.match(
  /- name: Build static site from microCMS[\s\S]*?(?=\n\s{6}- name:)/
)?.[0] || "";

if (!/fetch-depth:\s*0\b/.test(firstCheckoutStep)) {
  throw new Error("The production build must check out complete Git history for sitemap lastmod.");
}
if (!/CMS_DROP_GUARD_REQUIRED:\s*["']true["']/.test(productionBuildStep)) {
  throw new Error("The production microCMS build must fail closed when its live baseline is unavailable.");
}
if (/CMS_DROP_GUARD_REQUIRED/.test(fixtureBuildStep)) {
  throw new Error("The pull-request fixture build must not require the live CMS drop guard.");
}
if (!/REQUIRE_COMPLETE_GIT_HISTORY:\s*["']true["']/.test(productionBuildStep)) {
  throw new Error("The production build must reject incomplete Git history.");
}

const sitemap = await readFile(path.join(root, "_site", "sitemap.xml"), "utf8");
const sitemapLastmods = new Map(
  [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => [
    match[1].match(/<loc>(.*?)<\/loc>/)?.[1],
    match[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1]
  ])
);
const stablePages = [
  ["index.html", "https://ynakai-clinic.com/"],
  ["medical.html", "https://ynakai-clinic.com/medical.html"],
  ["varix.html", "https://ynakai-clinic.com/varix.html"],
  ["doctor.html", "https://ynakai-clinic.com/doctor.html"],
  ["gallery.html", "https://ynakai-clinic.com/gallery.html"],
  ["news.html", "https://ynakai-clinic.com/news.html"],
  ["access.html", "https://ynakai-clinic.com/access.html"],
  ["privacy.html", "https://ynakai-clinic.com/privacy.html"]
];

for (const [file, url] of stablePages) {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "-1", "--format=%cs", "--", file],
    { cwd: root }
  );
  const expectedLastmod = stdout.trim();
  const actualLastmod = sitemapLastmods.get(url);
  if (!expectedLastmod || actualLastmod !== expectedLastmod) {
    throw new Error(
      `${file}: sitemap lastmod ${actualLastmod || "missing"} does not match `
      + `the file's actual Git change date ${expectedLastmod || "missing"}.`
    );
  }
}

const canonicalFavicon = await readFile(path.join(root, "_site", "favicon-64.png"));
const legacyFavicon = await readFile(path.join(root, "_site", "favicon.png"));
if (!canonicalFavicon.equals(legacyFavicon)) {
  throw new Error("Legacy favicon URL does not serve the canonical clinic icon.");
}
await access(path.join(root, "_site", "favicon.ico"));

const sourceStylesheet = await readFile(path.join(root, "style.css"), "utf8");
const builtStylesheet = await readFile(path.join(root, "_site", "style.css"), "utf8");
if (builtStylesheet.length >= sourceStylesheet.length * 0.9) {
  throw new Error("Built stylesheet was not safely minified.");
}
if (!builtStylesheet.includes(".hero{position:relative")) {
  throw new Error("Minified stylesheet lost a critical hero rule.");
}

const builtHome = await readFile(path.join(root, "_site", "index.html"), "utf8");
if (!builtHome.includes('src="/logo.webp"')) {
  throw new Error("Generated pages do not use the optimized WebP logo.");
}

const logoPng = await readFile(path.join(root, "_site", "logo.png"));
const logoWebp = await readFile(path.join(root, "_site", "logo.webp"));
if (logoWebp.subarray(0, 4).toString("ascii") !== "RIFF" || logoWebp.subarray(8, 12).toString("ascii") !== "WEBP") {
  throw new Error("logo.webp is not a valid WebP asset.");
}
if (logoWebp.length >= logoPng.length) {
  throw new Error("Optimized logo is not smaller than its PNG source.");
}

async function articleBody(kind, id) {
  const html = await readFile(path.join(root, "_site", kind, `${id}.html`), "utf8");
  const match = html.match(/<div class="news-content"[^>]*>([\s\S]*?)<\/div>\s*<div class="back-news-area">/);
  if (!match) throw new Error(`Could not find generated body for ${kind}/${id}.`);
  return match[1];
}

const newsBody = await articleBody("news", "security-news");
const recruitBody = await articleBody("recruit", "security-recruit");

for (const [label, body] of [["news", newsBody], ["recruit", recruitBody]]) {
  for (const pattern of [
    /<script/i,
    /<style/i,
    /<iframe/i,
    /<object/i,
    /\son\w+\s*=/i,
    /javascript\s*:/i,
    /data\s*:/i,
    /position\s*:/i,
    /background-image\s*:/i
  ]) {
    if (pattern.test(body)) {
      throw new Error(`${label} body retained unsafe markup: ${pattern}`);
    }
  }
  if (!body.includes("<strong>formatting</strong>")) {
    throw new Error(`${label} body lost safe rich-text formatting.`);
  }
  if (!/text-align:\s*start/.test(body)) {
    throw new Error(`${label} body lost its safe text alignment.`);
  }
}

if (!newsBody.includes('src="https://images.microcms-assets.io/assets/test.png"')) {
  throw new Error("A safe HTTPS image was removed.");
}
if (!/target="_blank"[^>]*rel="[^"]*noopener[^"]*noreferrer/.test(newsBody)) {
  throw new Error("A new-window link was not protected with noopener/noreferrer.");
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

const invalidBody = await runBuild("test/fixtures/invalid-body.json");
const afterInvalidBody = await readFile(manifestPath, "utf8");
if (invalidBody.code === 0) {
  throw new Error("A non-string microCMS body unexpectedly passed.");
}
if (!invalidBody.stderr.includes("body must be a string")) {
  throw new Error(`Invalid body failed for the wrong reason:\n${invalidBody.stderr}`);
}
if (before !== afterInvalidBody) {
  throw new Error("A rejected microCMS body changed the existing output.");
}

console.log("Build safety test passed.");
