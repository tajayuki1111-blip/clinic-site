import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sanitizeHtml from "sanitize-html";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "_site");
const SITE_URL = "https://ynakai-clinic.com";
const CLINIC_NAME = "なかい内科血管外科クリニック";
const ASSET_VERSION = createHash("sha256")
  .update(await readFile(path.join(ROOT, "style.css")))
  .update(await readFile(path.join(ROOT, "site.js")))
  .digest("hex")
  .slice(0, 12);
const MICROCMS_API_KEY = process.env.MICROCMS_API_KEY;
const MICROCMS_FIXTURE_FILE = process.env.MICROCMS_FIXTURE_FILE;
const ALLOW_CMS_CONTENT_DROP = process.env.ALLOW_CMS_CONTENT_DROP === "true";
const CMS_DROP_GUARD_REQUIRED = process.env.CMS_DROP_GUARD_REQUIRED === "true";
const execFileAsync = promisify(execFile);

if (!MICROCMS_API_KEY && !MICROCMS_FIXTURE_FILE) {
  throw new Error("MICROCMS_API_KEY or MICROCMS_FIXTURE_FILE is required.");
}

const publishFiles = [
  "index.html",
  "medical.html",
  "varix.html",
  "doctor.html",
  "gallery.html",
  "access.html",
  "privacy.html",
  "404.html",
  "news.html",
  "style.css",
  "site.js",
  "robots.txt",
  "CNAME",
  ".nojekyll",
  "favicon-64.png",
  "favicon.ico",
  "logo.png",
  "clinic.webp",
  "doctor.webp",
  "inside1.webp",
  "inside2.webp",
  "inside3.webp",
  "inside4.webp",
  "parking.webp",
  "varix03.webp"
];

const stablePageDefinitions = [
  { path: "/", file: "index.html", fallbackLastmod: "2026-07-28", priority: "1.0" },
  { path: "/medical.html", file: "medical.html", fallbackLastmod: "2026-07-28", priority: "0.9" },
  { path: "/varix.html", file: "varix.html", fallbackLastmod: "2026-07-28", priority: "0.9" },
  { path: "/doctor.html", file: "doctor.html", fallbackLastmod: "2026-07-28", priority: "0.8" },
  { path: "/gallery.html", file: "gallery.html", fallbackLastmod: "2026-07-28", priority: "0.6" },
  { path: "/news.html", file: "news.html", fallbackLastmod: "2026-07-28", priority: "0.7" },
  { path: "/access.html", file: "access.html", fallbackLastmod: "2026-07-28", priority: "0.9" },
  { path: "/privacy.html", file: "privacy.html", fallbackLastmod: "2026-07-28", priority: "0.3" }
];

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const stripHtml = (value = "") =>
  String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const safeColorPattern = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$|^rgba?\(\s*(?:\d{1,3}%?\s*,\s*){2}\d{1,3}%?(?:\s*,\s*(?:0|1|0?\.\d+|\d{1,3}%))?\s*\)$/i;
const safeHeadingIdPattern = /^h[0-9a-f]{8,64}$/i;

const sanitizeHeading = (tagName, attribs) => {
  const next = { ...attribs };
  if (!safeHeadingIdPattern.test(next.id || "")) delete next.id;
  return { tagName, attribs: next };
};

const sanitizeLink = (tagName, attribs) => {
  const next = { ...attribs };
  const rel = new Set(
    String(next.rel || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((value) => ["nofollow", "ugc", "sponsored"].includes(value))
  );

  if (next.target === "_blank") {
    rel.add("noopener");
    rel.add("noreferrer");
  } else {
    delete next.target;
  }

  if (rel.size) next.rel = [...rel].join(" ");
  else delete next.rel;

  return { tagName, attribs: next };
};

const isSafeImageSource = (value = "") => {
  const source = String(value).trim();
  if (source.startsWith("/") && !source.startsWith("//")) return true;

  try {
    return new URL(source).protocol === "https:";
  } catch {
    return false;
  }
};

const sanitizeRichHtml = (value = "") =>
  sanitizeHtml(String(value), {
    allowedTags: [
      "p", "br", "h2", "h3", "h4", "h5", "hr", "blockquote", "pre", "div",
      "strong", "em", "u", "s", "sup", "sub", "code", "span",
      "ul", "ol", "li",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td",
      "figure", "figcaption", "img", "a"
    ],
    allowedAttributes: {
      p: ["style"],
      h2: ["id", "style"],
      h3: ["id", "style"],
      h4: ["id", "style"],
      h5: ["id", "style"],
      figure: ["style"],
      span: ["style"],
      a: ["href", "target", "rel", "title", "data-embed-type", "data-mime-type"],
      img: ["src", "alt", "width", "height", "loading", "decoding"],
      th: ["colspan", "rowspan", "scope"],
      td: ["colspan", "rowspan"],
      ol: ["start"],
      code: ["class"],
      div: ["data-filename"]
    },
    allowedStyles: {
      "*": {
        color: [safeColorPattern],
        "background-color": [safeColorPattern],
        "font-size": [/^(?:[5-9]\d|[12]\d{2}|300)%$/, /^(?:0\.75|1|1\.5|2\.5)em$/],
        "text-align": [/^(?:start|end|left|center|right|justify)$/],
        "padding-left": [/^(?:0|3em|6em|9em|12em)$/]
      }
    },
    allowedSchemes: ["http", "https", "mailto", "tel"],
    allowedSchemesAppliedToAttributes: ["href", "src"],
    allowProtocolRelative: false,
    transformTags: {
      h2: sanitizeHeading,
      h3: sanitizeHeading,
      h4: sanitizeHeading,
      h5: sanitizeHeading,
      a: sanitizeLink,
      code: (tagName, attribs) => {
        const next = { ...attribs };
        if (!/^language-[a-z0-9_-]+$/i.test(next.class || "")) delete next.class;
        return { tagName, attribs: next };
      }
    },
    exclusiveFilter: (frame) =>
      frame.tag === "img" && !isSafeImageSource(frame.attribs.src),
    enforceHtmlBoundary: true
  });

const sanitizeCollection = (endpoint, items) =>
  items.map((item, index) => {
    if (item.body != null && typeof item.body !== "string") {
      throw new Error(`microCMS ${endpoint}[${index}]: body must be a string.`);
    }
    return { ...item, body: sanitizeRichHtml(item.body || "") };
  });

const safeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

const toDate = (value, label = "date") => {
  if (!value) throw new Error(`${label} is required.`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is invalid: ${value}`);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

const itemDateValue = (item) =>
  item.revisedAt || item.updatedAt || item.publishedAt || item.createdAt;

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function validateCollectionItems(endpoint, contents, expectedTotal = contents?.length) {
  if (!Array.isArray(contents)) {
    throw new Error(`microCMS ${endpoint}: contents must be an array.`);
  }
  if (!Number.isInteger(expectedTotal) || expectedTotal < 0) {
    throw new Error(`microCMS ${endpoint}: totalCount must be a non-negative integer.`);
  }

  const ids = new Set();
  for (const [index, item] of contents.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`microCMS ${endpoint}[${index}]: item must be an object.`);
    }
    if (typeof item.id !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.id)) {
      throw new Error(`microCMS ${endpoint}[${index}]: invalid id.`);
    }
    if (ids.has(item.id)) {
      throw new Error(`microCMS ${endpoint}: duplicate id ${item.id}.`);
    }
    ids.add(item.id);
    if (typeof item.title !== "string" || !stripHtml(item.title)) {
      throw new Error(`microCMS ${endpoint}[${index}]: title is required.`);
    }
    toDate(itemDateValue(item), `microCMS ${endpoint}[${index}] date`);
  }
}

async function fetchJsonWithRetry(url, endpoint) {
  const maxAttempts = 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        headers: { "X-MICROCMS-API-KEY": MICROCMS_API_KEY },
        signal: controller.signal
      });

      if (response.ok) return await response.json();

      const retryable = response.status === 408
        || response.status === 429
        || response.status >= 500;
      if (!retryable) {
        const error = new Error(`microCMS ${endpoint} request failed: ${response.status}`);
        error.nonRetryable = true;
        throw error;
      }

      const retryAfter = Number(response.headers.get("retry-after"));
      lastError = new Error(`microCMS ${endpoint} temporary failure: ${response.status}`);
      if (attempt < maxAttempts) {
        await wait(Number.isFinite(retryAfter) ? retryAfter * 1000 : attempt * 500);
      }
    } catch (error) {
      if (error.nonRetryable) throw error;
      lastError = error;
      if (attempt < maxAttempts) await wait(attempt * 500);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(`microCMS ${endpoint} failed after 3 attempts: ${lastError?.message || "unknown error"}`);
}

const displayDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "numeric",
    day: "numeric"
  }).format(date);
};

async function fetchCollection(endpoint) {
  if (MICROCMS_FIXTURE_FILE) {
    const fixture = JSON.parse(await readFile(path.resolve(ROOT, MICROCMS_FIXTURE_FILE), "utf8"));
    const contents = fixture?.[endpoint];
    validateCollectionItems(endpoint, contents);
    return contents;
  }

  const all = [];
  const ids = new Set();
  let offset = 0;
  const limit = 100;
  let totalCount;

  while (true) {
    const url = new URL(`https://nakai-clinic.microcms.io/api/v1/${endpoint}`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("orders", "-publishedAt");
    const data = await fetchJsonWithRetry(url, endpoint);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error(`microCMS ${endpoint}: response must be an object.`);
    }
    if (!Array.isArray(data.contents)) {
      throw new Error(`microCMS ${endpoint}: contents must be an array.`);
    }
    if (!Number.isInteger(data.totalCount) || data.totalCount < 0) {
      throw new Error(`microCMS ${endpoint}: invalid totalCount.`);
    }
    if (totalCount === undefined) totalCount = data.totalCount;
    if (data.totalCount !== totalCount) {
      throw new Error(`microCMS ${endpoint}: totalCount changed during pagination.`);
    }

    const contents = data.contents;
    validateCollectionItems(endpoint, contents, data.totalCount);
    for (const item of contents) {
      if (ids.has(item.id)) throw new Error(`microCMS ${endpoint}: duplicate id ${item.id}.`);
      ids.add(item.id);
    }
    all.push(...contents);
    offset += contents.length;

    if (offset >= totalCount) break;
    if (contents.length === 0) {
      throw new Error(`microCMS ${endpoint}: pagination ended before totalCount.`);
    }
  }

  if (all.length !== totalCount) {
    throw new Error(`microCMS ${endpoint}: expected ${totalCount} items, received ${all.length}.`);
  }
  return all;
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function previousCmsState() {
  if (MICROCMS_FIXTURE_FILE) return null;

  try {
    const manifest = JSON.parse(await fetchText(`${SITE_URL}/cms-manifest.json`));
    if (!Array.isArray(manifest.newsIds) || !Array.isArray(manifest.recruitIds)) {
      throw new Error("invalid CMS manifest");
    }
    return {
      newsIds: new Set(manifest.newsIds),
      recruitIds: new Set(manifest.recruitIds)
    };
  } catch (manifestError) {
    try {
      const sitemap = await fetchText(`${SITE_URL}/sitemap.xml`);
      const ids = (kind) => new Set(
        [...sitemap.matchAll(new RegExp(`<loc>${SITE_URL}/${kind}/([^<]+)\\.html</loc>`, "g"))]
          .map((match) => decodeURIComponent(match[1]))
      );
      return { newsIds: ids("news"), recruitIds: ids("recruit") };
    } catch (sitemapError) {
      if (CMS_DROP_GUARD_REQUIRED) {
        throw new Error(`CMS drop guard could not read the live baseline: ${sitemapError.message}`);
      }
      console.warn(`CMS drop guard skipped: ${manifestError.message}; ${sitemapError.message}`);
      return null;
    }
  }
}

function assertSafeContentChange(label, previousIds, items) {
  if (!previousIds?.size || ALLOW_CMS_CONTENT_DROP) return;

  const nextIds = new Set(items.map((item) => item.id));
  const removed = [...previousIds].filter((id) => !nextIds.has(id));
  const removalRatio = removed.length / previousIds.size;
  const completeRemoval = nextIds.size === 0;
  const largeReplacement = removed.length >= 2 && removalRatio >= 0.5;

  if (completeRemoval || largeReplacement) {
    throw new Error(
      `microCMS ${label}: blocked unexpected content drop `
      + `(${previousIds.size} previous, ${nextIds.size} current, ${removed.length} removed). `
      + "Use ALLOW_CMS_CONTENT_DROP=true only for an intentional bulk change."
    );
  }
}

function latestModified(items, fallback) {
  if (!items.length) return fallback;
  return items
    .map((item, index) => toDate(itemDateValue(item), `item[${index}] date`))
    .sort()
    .at(-1);
}

async function sourceLastmod(file, fallback) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "-1", "--format=%cI", "--", file],
      { cwd: ROOT }
    );
    return stdout.trim() ? toDate(stdout.trim(), `${file} git date`) : fallback;
  } catch {
    return fallback;
  }
}

async function stablePagesForBuild(news, recruits, previous) {
  const pages = await Promise.all(stablePageDefinitions.map(async (page) => ({
    ...page,
    lastmod: await sourceLastmod(page.file, page.fallbackLastmod)
  })));

  const byPath = new Map(pages.map((page) => [page.path, page]));
  const home = byPath.get("/");
  const newsIndex = byPath.get("/news.html");
  const homeItems = [...news.slice(0, 3), ...recruits.slice(0, 3)];
  home.lastmod = [home.lastmod, latestModified(homeItems, home.lastmod)].sort().at(-1);
  newsIndex.lastmod = [
    newsIndex.lastmod,
    latestModified(news, newsIndex.lastmod)
  ].sort().at(-1);

  if (previous) {
    const changed = (kind, items) => {
      const previousIds = previous[`${kind}Ids`];
      const nextIds = new Set(items.map((item) => item.id));
      return previousIds.size !== nextIds.size
        || [...previousIds].some((id) => !nextIds.has(id));
    };
    const today = toDate(new Date(), "build date");
    if (changed("news", news) || changed("recruit", recruits)) home.lastmod = today;
    if (changed("news", news)) newsIndex.lastmod = today;
  }

  return pages;
}

async function writeDeploymentManifest() {
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) files.push(...await walk(full));
      else if (entry.name !== "deployment-manifest.json") files.push(full);
    }
    return files;
  }

  const hash = createHash("sha256");
  const files = (await walk(OUT)).sort();
  for (const file of files) {
    const relative = path.relative(OUT, file).replaceAll("\\", "/");
    hash.update(relative);
    hash.update("\0");
    hash.update(await readFile(file));
    hash.update("\0");
  }
  await writeFile(
    path.join(OUT, "deployment-manifest.json"),
    `${JSON.stringify({ sha256: hash.digest("hex") })}\n`,
    "utf8"
  );
}

function replaceBetween(html, marker, replacement) {
  const start = `<!-- SSG:${marker}_START -->`;
  const end = `<!-- SSG:${marker}_END -->`;
  const startIndex = html.indexOf(start);
  const endIndex = html.indexOf(end);
  if (startIndex < 0 || endIndex < 0 || endIndex < startIndex) {
    throw new Error(`Missing SSG marker: ${marker}`);
  }
  return `${html.slice(0, startIndex + start.length)}\n${replacement}\n${html.slice(endIndex)}`;
}

function normalizeAssetVersions(html) {
  return html
    .replace(/(style\.css\?v=)[^"'&<>\s]+/g, `$1${ASSET_VERSION}`)
    .replace(/(site\.js\?v=)[^"'&<>\s]+/g, `$1${ASSET_VERSION}`);
}

function removeMicroCmsClient(html) {
  return html
    .replace(/<link rel="preconnect" href="https:\/\/nakai-clinic\.microcms\.io" crossorigin>\s*/g, "")
    .replace(/<script>\s*const SERVICE_ID = "nakai-clinic";[\s\S]*?<\/script>\s*/g, "");
}

function topNewsHtml(news) {
  if (!news.length) return "<p>現在、お知らせはありません。</p>";
  return news.slice(0, 3).map((item) => `
<a href="/news/${encodeURIComponent(item.id)}.html" class="top-news-link">
  <div class="top-news-item">
    <time class="news-date" datetime="${toDate(item.publishedAt || item.createdAt)}">${escapeHtml(displayDate(item.publishedAt || item.createdAt))}</time>
    <div class="top-news-title">${escapeHtml(stripHtml(item.title))}</div>
    <div class="top-news-arrow" aria-hidden="true">›</div>
  </div>
</a>`).join("\n");
}

function recruitHtml(recruits) {
  if (!recruits.length) return "<p>現在募集しておりません。</p>";
  return recruits.slice(0, 3).map((item) => `
<a href="/recruit/${encodeURIComponent(item.id)}.html" class="top-news-link">
  <div class="top-news-item">
    <div class="top-news-title">${escapeHtml(stripHtml(item.title))}</div>
    <div class="top-news-arrow" aria-hidden="true">›</div>
  </div>
</a>`).join("\n");
}

function newsListHtml(news) {
  if (!news.length) {
    return '<div class="news-item"><div class="news-content">現在、お知らせはありません。</div></div>';
  }

  return news.map((item, index) => `
<a href="/news/${encodeURIComponent(item.id)}.html" class="news-list-link">
  <div class="news-row ${index % 2 === 0 ? "news-row-blue" : "news-row-white"}">
    <time class="news-date" datetime="${toDate(item.publishedAt || item.createdAt)}">${escapeHtml(displayDate(item.publishedAt || item.createdAt))}</time>
    <div class="news-title" style="font-weight:normal;">${escapeHtml(stripHtml(item.title))}</div>
    <div class="news-arrow" aria-hidden="true">›</div>
  </div>
</a>`).join("\n");
}

function siteHeader({ title, description, canonical, type = "article", image = `${SITE_URL}/clinic.webp`, schema }) {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#ffffff">
<link rel="icon" href="/favicon-64.png" type="image/png" sizes="64x64">
<meta name="description" content="${escapeHtml(description)}">
<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:type" content="${type}">
<meta property="og:locale" content="ja_JP">
<meta property="og:site_name" content="${CLINIC_NAME}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:alt" content="なかい内科血管外科クリニック">
<meta name="twitter:card" content="summary_large_image">
<link rel="alternate" hreflang="ja-JP" href="${escapeHtml(canonical)}">
<script type="application/ld+json">${safeJson(schema)}</script>
<script src="/site.js?v=${ASSET_VERSION}" defer data-ga-id="G-NK74HRTVZN"></script>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}">
</head>
<body>
<header>
<div class="container header-inner">
<a href="/" class="logo-link">
<img src="/logo.png" class="header-logo" alt="${CLINIC_NAME}" width="310" height="65" decoding="async">
</a>
<div class="header-right">
<div class="header-tel"><a href="tel:0728732700"><span class="tel-icon">☎</span>072-873-2700</a></div>
<nav aria-label="メインメニュー">
<a href="/">ホーム</a>
<a href="/medical.html">診療内容</a>
<a href="/varix.html">下肢静脈瘤について</a>
<a href="/doctor.html">医師紹介</a>
<a href="/gallery.html">院内紹介</a>
<a href="/news.html">お知らせ</a>
<a href="/access.html">診療時間・アクセス</a>
<a href="tel:0728732700" class="sp-tel-link"><span class="sp-tel-icon">☎</span>072-873-2700</a>
</nav>
</div>
<button class="menu-btn" type="button" aria-label="メニューを開閉" aria-expanded="false"
onclick="const open=document.body.classList.toggle('menu-open');this.setAttribute('aria-expanded',String(open))">
<span></span><span></span><span></span>
</button>
</div>
</header>`;
}

const clinicInfo = `
<section class="clinic-info" aria-labelledby="clinic-info-title">
<div class="container">
<div class="clinic-info-heading">
<div class="clinic-info-brand">
<img src="/logo.png" alt="${CLINIC_NAME}" width="310" height="65" loading="lazy" decoding="async">
<div>
<p class="clinic-info-kicker">大阪府大東市寺川の内科・循環器内科・血管外科</p>
<h2 id="clinic-info-title">${CLINIC_NAME}</h2>
<address>〒574-0014 大阪府大東市寺川3丁目9-16</address>
</div>
</div>
<a class="clinic-info-tel" href="tel:0728732700">
<span>お電話でのお問い合わせ</span>
<strong>☎ 072-873-2700</strong>
</a>
</div>

<div class="clinic-info-grid">
<div class="clinic-info-details">
<h3>診療時間</h3>
<div class="clinic-info-schedule-scroll">
<table class="clinic-info-schedule">
<thead>
<tr>
<th scope="col">診療<span class="clinic-info-mobile-break"><br></span>時間</th>
<th scope="col">月</th>
<th scope="col">火</th>
<th scope="col">水</th>
<th scope="col">木</th>
<th scope="col">金</th>
<th scope="col">土</th>
<th scope="col">日・祝</th>
</tr>
</thead>
<tbody>
<tr>
<th scope="row">9:00〜<span class="clinic-info-mobile-break"><br></span>12:00</th>
<td>○</td><td>○</td><td>○</td><td>×</td><td>○</td><td>○</td><td>×</td>
</tr>
<tr>
<th scope="row">16:00〜<span class="clinic-info-mobile-break"><br></span>18:00</th>
<td>○</td><td>○</td><td>○</td><td>×</td><td>○</td><td>×</td><td>×</td>
</tr>
</tbody>
</table>
</div>
<p class="clinic-info-closed">休診日：木曜・土曜午後・日曜・祝日</p>
<a class="clinic-info-access-button" href="/access.html">診療時間・アクセスを見る</a>
</div>

<div class="clinic-info-map">
<iframe
src="https://www.google.com/maps?q=34.7110173,135.6428162&amp;z=16&amp;output=embed&amp;hl=ja"
loading="lazy"
title="${CLINIC_NAME}周辺地図"
referrerpolicy="no-referrer-when-downgrade"
allowfullscreen>
</iframe>
</div>
</div>

<ul class="clinic-info-route">
<li><strong>電車</strong> JR野崎駅から徒歩約15分</li>
<li><strong>バス</strong> 近鉄バス「寺川」バス停から徒歩約2分</li>
<li><strong>お車</strong> 専用駐車場5台あり</li>
</ul>
</div>
</section>`;

const siteFooter = `${clinicInfo}
<footer>
<div class="container">
<p class="footer-links"><a href="/privacy.html">プライバシーポリシー</a></p>
<p>© ${CLINIC_NAME}</p>
</div>
</footer>
<div class="fixed-call"><a href="tel:0728732700">☎ 072-873-2700</a></div>
</body>
</html>`;

function newsArticleHtml(item) {
  const plainTitle = stripHtml(item.title) || "お知らせ";
  const description = (stripHtml(item.body) || `${plainTitle}についてのお知らせです。`).slice(0, 120);
  const canonical = `${SITE_URL}/news/${encodeURIComponent(item.id)}.html`;
  const published = item.publishedAt || item.createdAt;
  const modified = item.revisedAt || item.updatedAt || published;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "NewsArticle",
        "@id": `${canonical}#article`,
        headline: plainTitle,
        description,
        datePublished: published,
        dateModified: modified,
        inLanguage: "ja-JP",
        mainEntityOfPage: canonical,
        author: { "@type": "Organization", name: CLINIC_NAME, url: SITE_URL },
        publisher: {
          "@type": "MedicalClinic",
          "@id": `${SITE_URL}/#clinic`,
          name: CLINIC_NAME,
          logo: { "@type": "ImageObject", url: `${SITE_URL}/logo.png` }
        }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "ホーム", item: `${SITE_URL}/` },
          { "@type": "ListItem", position: 2, name: "お知らせ", item: `${SITE_URL}/news.html` },
          { "@type": "ListItem", position: 3, name: plainTitle, item: canonical }
        ]
      }
    ]
  };

  return `${siteHeader({
    title: `${plainTitle}｜${CLINIC_NAME}`,
    description,
    canonical,
    schema
  })}
<main class="container">
<article class="news-detail" itemscope itemtype="https://schema.org/NewsArticle">
<div class="news-item">
<time class="news-date" datetime="${toDate(published)}" itemprop="datePublished">${escapeHtml(displayDate(published))}</time>
<h1 class="news-detail-title" itemprop="headline">${escapeHtml(plainTitle)}</h1>
<div class="news-content" itemprop="articleBody">${item.body || ""}</div>
<div class="back-news-area"><a href="/news.html" class="back-news-btn">お知らせ一覧に戻る</a></div>
</div>
</article>
</main>
${siteFooter}`;
}

function recruitArticleHtml(item) {
  const plainTitle = stripHtml(item.title) || "スタッフ募集";
  const description = (stripHtml(item.body) || `${plainTitle}についての募集情報です。`).slice(0, 120);
  const canonical = `${SITE_URL}/recruit/${encodeURIComponent(item.id)}.html`;
  const published = item.publishedAt || item.createdAt;
  const modified = item.revisedAt || item.updatedAt || published;
  const schema = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: plainTitle,
    url: canonical,
    datePublished: published,
    dateModified: modified,
    inLanguage: "ja-JP",
    author: { "@type": "MedicalClinic", "@id": `${SITE_URL}/#clinic`, name: CLINIC_NAME }
  };

  return `${siteHeader({
    title: `${plainTitle}｜${CLINIC_NAME}`,
    description,
    canonical,
    schema
  })}
<main class="container">
<article class="news-detail">
<div class="news-item">
<h1 class="news-detail-title">${escapeHtml(plainTitle)}</h1>
<div class="news-content">${item.body || ""}</div>
<div class="back-news-area"><a href="/#recruit" class="back-news-btn">スタッフ募集へ戻る</a></div>
</div>
</article>
</main>
${siteFooter}`;
}

function legacyRedirectHtml(kind) {
  const isNews = kind === "news";
  const label = isNews ? "お知らせ" : "スタッフ募集";
  const target = isNews ? "news" : "recruit";
  const fallback = isNews ? "/news.html" : "/#recruit";
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="icon" href="/favicon-64.png" type="image/png" sizes="64x64">
<meta name="robots" content="noindex,follow">
<title>${label}ページへ移動します｜${CLINIC_NAME}</title>
<link rel="stylesheet" href="/style.css?v=${ASSET_VERSION}">
</head>
<body>
<main class="container not-found">
<h1 class="page-title">${label}ページへ移動します</h1>
<p>自動的に新しいURLへ移動します。</p>
<p><a id="destination" href="${fallback}">${label}ページを開く</a></p>
</main>
<script>
const id = new URLSearchParams(location.search).get("id");
const destination = id ? "/${target}/" + encodeURIComponent(id) + ".html" : "${fallback}";
document.getElementById("destination").href = destination;
location.replace(destination);
</script>
</body>
</html>`;
}

function sitemapXml(stablePages, news, recruits) {
  const urls = [
    ...stablePages,
    ...news.map((item) => ({
      path: `/news/${encodeURIComponent(item.id)}.html`,
      lastmod: toDate(itemDateValue(item), `news ${item.id} date`),
      priority: "0.6"
    })),
    ...recruits.map((item) => ({
      path: `/recruit/${encodeURIComponent(item.id)}.html`,
      lastmod: toDate(itemDateValue(item), `recruit ${item.id} date`),
      priority: "0.4"
    }))
  ];

  const body = urls.map((item) => `  <url>
    <loc>${SITE_URL}${item.path}</loc>
    <lastmod>${item.lastmod}</lastmod>
    <priority>${item.priority}</priority>
  </url>`).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
}

const previous = await previousCmsState();
const [rawNews, rawRecruits] = await Promise.all([
  fetchCollection("news"),
  fetchCollection("recruit")
]);
const news = sanitizeCollection("news", rawNews);
const recruits = sanitizeCollection("recruit", rawRecruits);
assertSafeContentChange("news", previous?.newsIds, news);
assertSafeContentChange("recruit", previous?.recruitIds, recruits);
const stablePages = await stablePagesForBuild(news, recruits, previous);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const file of publishFiles) {
  await cp(path.join(ROOT, file), path.join(OUT, file), { recursive: true });
}
await cp(path.join(ROOT, "favicon-64.png"), path.join(OUT, "favicon.png"));

for (const file of publishFiles.filter((file) => file.endsWith(".html"))) {
  const destination = path.join(OUT, file);
  let html = normalizeAssetVersions(await readFile(destination, "utf8"));
  if (!html.includes('class="clinic-info"')) {
    html = html.replace("</main>", `</main>${clinicInfo}`);
  }
  await writeFile(destination, html, "utf8");
}

let home = await readFile(path.join(OUT, "index.html"), "utf8");
home = replaceBetween(home, "TOP_NEWS", topNewsHtml(news));
home = replaceBetween(home, "RECRUIT", recruitHtml(recruits));
home = removeMicroCmsClient(home);
await writeFile(path.join(OUT, "index.html"), home, "utf8");

let newsIndex = await readFile(path.join(OUT, "news.html"), "utf8");
newsIndex = replaceBetween(newsIndex, "NEWS_LIST", newsListHtml(news));
newsIndex = removeMicroCmsClient(newsIndex);
newsIndex = newsIndex.replace(
  /("dateModified":")\d{4}-\d{2}-\d{2}(")/,
  `$1${stablePages.find((page) => page.path === "/news.html").lastmod}$2`
);
await writeFile(path.join(OUT, "news.html"), newsIndex, "utf8");

await mkdir(path.join(OUT, "news"), { recursive: true });
for (const item of news) {
  await writeFile(
    path.join(OUT, "news", `${item.id}.html`),
    newsArticleHtml(item),
    "utf8"
  );
}

await mkdir(path.join(OUT, "recruit"), { recursive: true });
for (const item of recruits) {
  await writeFile(
    path.join(OUT, "recruit", `${item.id}.html`),
    recruitArticleHtml(item),
    "utf8"
  );
}

await writeFile(path.join(OUT, "news-detail.html"), legacyRedirectHtml("news"), "utf8");
await writeFile(path.join(OUT, "recruit-detail.html"), legacyRedirectHtml("recruit"), "utf8");
await writeFile(path.join(OUT, "sitemap.xml"), sitemapXml(stablePages, news, recruits), "utf8");
await writeFile(
  path.join(OUT, "cms-manifest.json"),
  `${JSON.stringify({
    newsIds: news.map((item) => item.id),
    recruitIds: recruits.map((item) => item.id)
  })}\n`,
  "utf8"
);
await writeDeploymentManifest();

console.log(`Built ${stablePages.length} stable pages, ${news.length} news pages, and ${recruits.length} recruit pages.`);
