import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || "_site");
const siteUrl = "https://ynakai-clinic.com";
const errors = [];
const indexablePages = [];
const titles = new Map();
const descriptions = new Map();

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

function text(value = "") {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i"));
  return match ? match[2] : "";
}

function expectedCanonical(relative) {
  if (relative === "index.html") return `${siteUrl}/`;
  return `${siteUrl}/${relative.replaceAll("\\", "/")}`;
}

function recordUnique(map, value, relative, label) {
  if (!value) return;
  if (map.has(value)) errors.push(`${relative}: duplicate ${label} with ${map.get(value)}`);
  else map.set(value, relative);
}

const files = await walk(root);
const htmlFiles = files.filter((file) => file.endsWith(".html"));

for (const file of htmlFiles) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  const html = await readFile(file, "utf8");
  const noindex = /<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
  const title = text(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description = attr(html.match(/<meta\s+name=["']description["'][^>]*>/i)?.[0] || "", "content");
  const canonical = attr(html.match(/<link\s+rel=["']canonical["'][^>]*>/i)?.[0] || "", "href");
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));

  if (!title) errors.push(`${relative}: missing title`);
  if (h1Count !== 1) errors.push(`${relative}: expected exactly one H1, found ${h1Count}`);
  for (let index = 1; index < headings.length; index += 1) {
    if (headings[index] > headings[index - 1] + 1) {
      errors.push(`${relative}: heading level jumps from H${headings[index - 1]} to H${headings[index]}`);
    }
  }

  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    if (!/\balt=(["']).*?\1/i.test(match[0])) {
      errors.push(`${relative}: image is missing alt text`);
    }
  }

  for (const match of html.matchAll(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const json = match[1].trim();
    if (!json) {
      errors.push(`${relative}: empty JSON-LD`);
      continue;
    }
    try {
      JSON.parse(json);
    } catch (error) {
      errors.push(`${relative}: invalid JSON-LD (${error.message})`);
    }
  }

  if (/const\s+API_KEY|X-MICROCMS-API-KEY|microcms\.io\/api\//i.test(html)) {
    errors.push(`${relative}: microCMS API credential or client API call remains in published HTML`);
  }

  if (/http:\/\/ynakai-clinic\.com/i.test(html)) {
    errors.push(`${relative}: HTTP clinic URL remains`);
  }

  if (!noindex) {
    indexablePages.push(relative);
    if (!description) errors.push(`${relative}: missing meta description`);
    if (canonical !== expectedCanonical(relative)) {
      errors.push(`${relative}: canonical mismatch (${canonical || "missing"})`);
    }
    if (!/<meta\s+property=["']og:title["']/i.test(html)) errors.push(`${relative}: missing og:title`);
    if (!/<meta\s+property=["']og:url["']/i.test(html)) errors.push(`${relative}: missing og:url`);
    recordUnique(titles, title, relative, "title");
    recordUnique(descriptions, description, relative, "description");
  }

  for (const match of html.matchAll(/<a\b[^>]*href=(["'])(.*?)\1/gi)) {
    const href = match[2].trim();
    if (!href || href.startsWith("#") || /^(https?:|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    const urlPath = href.split("#")[0].split("?")[0];
    if (!urlPath) continue;
    let target;
    if (urlPath.startsWith("/")) target = path.join(root, urlPath.slice(1));
    else target = path.resolve(path.dirname(file), urlPath);
    if (urlPath.endsWith("/") || target === root) target = path.join(target, "index.html");
    try {
      await access(target);
    } catch {
      errors.push(`${relative}: broken internal link ${href}`);
    }
  }
}

const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
const sitemapUrls = new Set([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]));
for (const relative of indexablePages) {
  const canonical = expectedCanonical(relative);
  if (!sitemapUrls.has(canonical)) errors.push(`${relative}: missing from sitemap.xml`);
}

const robots = await readFile(path.join(root, "robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`)) {
  errors.push("robots.txt: sitemap declaration is missing");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`SEO validation passed for ${htmlFiles.length} HTML files (${indexablePages.length} indexable).`);
