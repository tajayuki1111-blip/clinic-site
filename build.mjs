import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUT = path.join(ROOT, "_site");
const SITE_URL = "https://ynakai-clinic.com";
const CLINIC_NAME = "なかい内科血管外科クリニック";
const MICROCMS_API_KEY = process.env.MICROCMS_API_KEY;

if (!MICROCMS_API_KEY) {
  throw new Error("MICROCMS_API_KEY is required.");
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
  "robots.txt",
  "CNAME",
  ".nojekyll",
  "favicon-64.png",
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

const stablePages = [
  { path: "/", lastmod: "2026-07-28", priority: "1.0" },
  { path: "/medical.html", lastmod: "2026-07-28", priority: "0.9" },
  { path: "/varix.html", lastmod: "2026-07-28", priority: "0.9" },
  { path: "/doctor.html", lastmod: "2026-07-28", priority: "0.8" },
  { path: "/gallery.html", lastmod: "2026-07-28", priority: "0.6" },
  { path: "/news.html", lastmod: "2026-07-28", priority: "0.7" },
  { path: "/access.html", lastmod: "2026-07-28", priority: "0.9" },
  { path: "/privacy.html", lastmod: "2026-07-28", priority: "0.3" }
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

const safeJson = (value) => JSON.stringify(value).replaceAll("<", "\\u003c");

const toDate = (value) => {
  if (!value) return "2026-07-28";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "2026-07-28";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
};

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
  const all = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    const url = new URL(`https://nakai-clinic.microcms.io/api/v1/${endpoint}`);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("orders", "-publishedAt");
    const response = await fetch(url, {
      headers: { "X-MICROCMS-API-KEY": MICROCMS_API_KEY }
    });

    if (!response.ok) {
      throw new Error(`microCMS ${endpoint} request failed: ${response.status}`);
    }

    const data = await response.json();
    const contents = Array.isArray(data.contents) ? data.contents : [];
    all.push(...contents);
    offset += contents.length;

    if (offset >= Number(data.totalCount || 0) || contents.length === 0) break;
  }

  return all;
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
    <time class="news-date" datetime="${toDate(item.publishedAt)}">${escapeHtml(displayDate(item.publishedAt))}</time>
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
    <time class="news-date" datetime="${toDate(item.publishedAt)}">${escapeHtml(displayDate(item.publishedAt))}</time>
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
<link rel="icon" href="/favicon-64.png" sizes="64x64">
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
<script async src="https://www.googletagmanager.com/gtag/js?id=G-NK74HRTVZN"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', 'G-NK74HRTVZN');
</script>
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="/style.css?v=20260728d">
</head>
<body>
<header>
<div class="container header-inner">
<a href="/" class="logo-link">
<img src="/logo.png" class="header-logo" alt="${CLINIC_NAME}" width="310" height="65" decoding="async">
</a>
<div class="header-right">
<div class="header-tel"><a href="tel:0728732700"><span class="tel-icon">☎</span>072-873-2700</a></div>
<button class="menu-btn" type="button" aria-label="メニューを開閉" aria-expanded="false"><span></span><span></span><span></span></button>
</div>
</div>
<nav class="nav-menu" aria-label="メインメニュー">
<div class="nav-inner">
<a href="/">ホーム</a>
<a href="/medical.html">診療内容</a>
<a href="/varix.html">下肢静脈瘤</a>
<a href="/doctor.html">医師紹介</a>
<a href="/gallery.html">院内紹介</a>
<a href="/news.html">お知らせ</a>
<a href="/access.html">アクセス</a>
</div>
</nav>
<div class="menu-overlay"></div>
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
src="https://www.google.com/maps?q=大阪府大東市寺川3丁目9-16&amp;output=embed"
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
<script>
const menuButton = document.querySelector(".menu-btn");
const navigation = document.querySelector(".nav-menu");
const overlay = document.querySelector(".menu-overlay");
function toggleMenu(){
  const isOpen = navigation.classList.toggle("active");
  menuButton.classList.toggle("active", isOpen);
  overlay.classList.toggle("active", isOpen);
  menuButton.setAttribute("aria-expanded", String(isOpen));
}
menuButton.addEventListener("click", toggleMenu);
overlay.addEventListener("click", toggleMenu);
</script>
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
<meta name="robots" content="noindex,follow">
<title>${label}ページへ移動します｜${CLINIC_NAME}</title>
<link rel="stylesheet" href="/style.css?v=20260728d">
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

function sitemapXml(news, recruits) {
  const urls = [
    ...stablePages,
    ...news.map((item) => ({
      path: `/news/${encodeURIComponent(item.id)}.html`,
      lastmod: toDate(item.revisedAt || item.updatedAt || item.publishedAt),
      priority: "0.6"
    })),
    ...recruits.map((item) => ({
      path: `/recruit/${encodeURIComponent(item.id)}.html`,
      lastmod: toDate(item.revisedAt || item.updatedAt || item.publishedAt),
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

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

for (const file of publishFiles) {
  await cp(path.join(ROOT, file), path.join(OUT, file), { recursive: true });
}

for (const file of publishFiles.filter((file) => file.endsWith(".html"))) {
  const destination = path.join(OUT, file);
  const html = await readFile(destination, "utf8");
  if (!html.includes('class="clinic-info"')) {
    await writeFile(destination, html.replace("</main>", `</main>${clinicInfo}`), "utf8");
  }
}

const [news, recruits] = await Promise.all([
  fetchCollection("news"),
  fetchCollection("recruit")
]);

let home = await readFile(path.join(OUT, "index.html"), "utf8");
home = replaceBetween(home, "TOP_NEWS", topNewsHtml(news));
home = replaceBetween(home, "RECRUIT", recruitHtml(recruits));
home = removeMicroCmsClient(home);
await writeFile(path.join(OUT, "index.html"), home, "utf8");

let newsIndex = await readFile(path.join(OUT, "news.html"), "utf8");
newsIndex = replaceBetween(newsIndex, "NEWS_LIST", newsListHtml(news));
newsIndex = removeMicroCmsClient(newsIndex);
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
await writeFile(path.join(OUT, "sitemap.xml"), sitemapXml(news, recruits), "utf8");

console.log(`Built ${stablePages.length} stable pages, ${news.length} news pages, and ${recruits.length} recruit pages.`);
