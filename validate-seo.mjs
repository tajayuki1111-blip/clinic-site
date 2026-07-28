import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(process.argv[2] || "_site");
const siteUrl = "https://ynakai-clinic.com";
const errors = [];
const indexablePages = [];
const titles = new Map();
const descriptions = new Map();
const pageData = new Map();
const inboundLinks = new Map();

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
  const robotsTags = [...html.matchAll(/<meta\s+name=["']robots["'][^>]*>/gi)];
  const descriptionTags = [...html.matchAll(/<meta\s+name=["']description["'][^>]*>/gi)];
  const canonicalTags = [...html.matchAll(/<link\s+rel=["']canonical["'][^>]*>/gi)];
  const noindex = robotsTags.some((match) => /\bnoindex\b/i.test(attr(match[0], "content")));
  const title = text(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "");
  const description = attr(descriptionTags[0]?.[0] || "", "content");
  const canonical = attr(canonicalTags[0]?.[0] || "", "href");
  const h1Count = (html.match(/<h1\b/gi) || []).length;
  const headings = [...html.matchAll(/<h([1-6])\b[^>]*>/gi)].map((match) => Number(match[1]));

  if (!title) errors.push(`${relative}: missing title`);
  if (robotsTags.length > 1) errors.push(`${relative}: multiple robots meta tags`);
  if (descriptionTags.length > 1) errors.push(`${relative}: multiple meta descriptions`);
  if (canonicalTags.length > 1) errors.push(`${relative}: multiple canonical links`);
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
      const parsed = JSON.parse(json);
      if (parsed?.["@context"] !== "https://schema.org") {
        errors.push(`${relative}: JSON-LD is missing the Schema.org context`);
      }
      if (!parsed?.["@type"] && !Array.isArray(parsed?.["@graph"])) {
        errors.push(`${relative}: JSON-LD is missing @type or @graph`);
      }
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
  if (/<script\b[^>]*\ssrc=["']https:\/\/www\.googletagmanager\.com\/gtag\/js/i.test(html)) {
    errors.push(`${relative}: Google Analytics is loaded before the shared delay loader`);
  }
  if (/<iframe\b[^>]*\ssrc=["']https:\/\/www\.google\.com\/maps/i.test(html)) {
    errors.push(`${relative}: Google Maps iframe is not click-to-load`);
  }
  if (/style\.css\?v=20260728[eh]\b/i.test(html)) {
    errors.push(`${relative}: stale stylesheet cache key remains`);
  }
  if (/^(news|recruit)\//.test(relative)) {
    if (/class=["'][^"']*\bnav-menu\b/i.test(html) || /\bmenu-overlay\b/i.test(html)) {
      errors.push(`${relative}: generated page uses the obsolete mobile navigation`);
    }
    if (!/body\.classList\.toggle\(["']menu-open["']\)/.test(html)) {
      errors.push(`${relative}: generated page is missing the shared mobile menu state`);
    }
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

  pageData.set(relative, { canonical, html, noindex });

  for (const match of html.matchAll(/<a\b[^>]*href=(["'])(.*?)\1/gi)) {
    const href = match[2].trim();
    if (!href || href.startsWith("#") || /^(mailto:|tel:|javascript:|data:)/i.test(href)) continue;

    let internalHref = href;
    if (/^https?:/i.test(href)) {
      let absolute;
      try {
        absolute = new URL(href);
      } catch {
        errors.push(`${relative}: invalid URL ${href}`);
        continue;
      }
      if (absolute.origin !== siteUrl) continue;
      internalHref = `${absolute.pathname}${absolute.search}${absolute.hash}`;
    }

    const urlPath = internalHref.split("#")[0].split("?")[0];
    if (!urlPath) continue;
    let target;
    if (urlPath.startsWith("/")) target = path.join(root, urlPath.slice(1));
    else target = path.resolve(path.dirname(file), urlPath);
    if (urlPath.endsWith("/") || target === root) target = path.join(target, "index.html");
    try {
      await access(target);
      const targetRelative = path.relative(root, target).replaceAll("\\", "/");
      if (!targetRelative.startsWith("../") && targetRelative !== relative) {
        if (!inboundLinks.has(targetRelative)) inboundLinks.set(targetRelative, new Set());
        inboundLinks.get(targetRelative).add(relative);
      }
    } catch {
      errors.push(`${relative}: broken internal link ${href}`);
    }
  }
}

const sitemap = await readFile(path.join(root, "sitemap.xml"), "utf8");
const sitemapEntries = [...sitemap.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((match) => ({
  loc: match[1].match(/<loc>(.*?)<\/loc>/)?.[1] || "",
  lastmod: match[1].match(/<lastmod>(.*?)<\/lastmod>/)?.[1] || ""
}));
const sitemapUrls = new Set();
for (const entry of sitemapEntries) {
  if (!entry.loc) {
    errors.push("sitemap.xml: URL entry is missing loc");
    continue;
  }
  if (sitemapUrls.has(entry.loc)) errors.push(`sitemap.xml: duplicate URL ${entry.loc}`);
  sitemapUrls.add(entry.loc);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.lastmod)
    || Number.isNaN(new Date(`${entry.lastmod}T00:00:00Z`).getTime())) {
    errors.push(`sitemap.xml: invalid lastmod for ${entry.loc}`);
  }

  let sitemapUrl;
  try {
    sitemapUrl = new URL(entry.loc);
  } catch {
    errors.push(`sitemap.xml: invalid URL ${entry.loc}`);
    continue;
  }
  if (sitemapUrl.origin !== siteUrl || sitemapUrl.search || sitemapUrl.hash) {
    errors.push(`sitemap.xml: URL must be a clean clinic URL (${entry.loc})`);
    continue;
  }
  let targetRelative = decodeURIComponent(sitemapUrl.pathname.replace(/^\//, ""));
  if (!targetRelative || targetRelative.endsWith("/")) targetRelative += "index.html";
  const targetPage = pageData.get(targetRelative);
  if (!targetPage) {
    errors.push(`sitemap.xml: URL has no generated HTML (${entry.loc})`);
  } else if (targetPage.noindex || targetPage.canonical !== entry.loc) {
    errors.push(`sitemap.xml: URL is not indexable with a self canonical (${entry.loc})`);
  }
}
for (const relative of indexablePages) {
  const canonical = expectedCanonical(relative);
  if (!sitemapUrls.has(canonical)) errors.push(`${relative}: missing from sitemap.xml`);
  if (relative !== "index.html" && !inboundLinks.get(relative)?.size) {
    errors.push(`${relative}: orphan indexable page has no internal link`);
  }
}

const stylesheet = await readFile(path.join(root, "style.css"), "utf8");
if (/fonts\.googleapis\.com|@import\s+url/i.test(stylesheet)) {
  errors.push("style.css: render-blocking external font import remains");
}
await access(path.join(root, "site.js"));

const robots = await readFile(path.join(root, "robots.txt"), "utf8");
if (!robots.includes(`Sitemap: ${siteUrl}/sitemap.xml`)) {
  errors.push("robots.txt: sitemap declaration is missing");
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`SEO validation passed for ${htmlFiles.length} HTML files (${indexablePages.length} indexable).`);
