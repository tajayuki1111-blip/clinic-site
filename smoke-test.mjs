const baseUrl = new URL(process.argv[2] || "https://ynakai-clinic.com/");
const errors = [];

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function fetchWithRetry(url, options = {}) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, {
        redirect: "follow",
        ...options,
        signal: controller.signal
      });
      if (response.status < 500) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < 6) await wait(attempt * 2000);
  }
  throw lastError;
}

function attr(tag, name) {
  const match = tag.match(new RegExp(`\\b${name}=(["'])(.*?)\\1`, "i"));
  return match ? match[2] : "";
}

const robotsResponse = await fetchWithRetry(new URL("/robots.txt", baseUrl));
if (robotsResponse.status !== 200) errors.push(`robots.txt returned ${robotsResponse.status}`);
const robots = await robotsResponse.text();
if (!robots.includes(`Sitemap: ${baseUrl.origin}/sitemap.xml`)) {
  errors.push("robots.txt does not declare the canonical sitemap");
}

const sitemapResponse = await fetchWithRetry(new URL("/sitemap.xml", baseUrl));
if (sitemapResponse.status !== 200) errors.push(`sitemap.xml returned ${sitemapResponse.status}`);
const sitemap = await sitemapResponse.text();
const urls = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
if (!urls.length) errors.push("sitemap.xml contains no URLs");

const homeResponse = await fetchWithRetry(baseUrl);
const homeHtml = await homeResponse.text();
const faviconTag = homeHtml.match(/<link\b[^>]*\brel=["']icon["'][^>]*>/i)?.[0] || "";
if (attr(faviconTag, "href") !== "/favicon-64.png"
  || attr(faviconTag, "type") !== "image/png"
  || attr(faviconTag, "sizes") !== "64x64") {
  errors.push("homepage favicon declaration is missing or invalid");
}

for (const url of urls) {
  const response = await fetchWithRetry(url);
  const html = await response.text();
  if (response.status !== 200) {
    errors.push(`${url} returned ${response.status}`);
    continue;
  }
  const canonicalTag = html.match(/<link\s+rel=["']canonical["'][^>]*>/i)?.[0] || "";
  const canonical = attr(canonicalTag, "href");
  if (canonical !== url) errors.push(`${url} canonical mismatch (${canonical || "missing"})`);
  if (/<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html)) {
    errors.push(`${url} is noindex but appears in sitemap.xml`);
  }
  if (/\/(news|recruit)\//.test(new URL(url).pathname)) {
    if (/class=["'][^"']*\bnav-menu\b/i.test(html) || /\bmenu-overlay\b/i.test(html)) {
      errors.push(`${url} uses the obsolete mobile menu`);
    }
    if (!/body\.classList\.toggle\(["']menu-open["']\)/.test(html)) {
      errors.push(`${url} is missing the shared mobile menu state`);
    }
  }
}

const missingUrl = new URL(`/seo-smoke-test-${Date.now()}.html`, baseUrl);
const missingResponse = await fetchWithRetry(missingUrl);
if (missingResponse.status !== 404) {
  errors.push(`missing URL returned ${missingResponse.status} instead of 404`);
}

const httpResponse = await fetchWithRetry(`http://${baseUrl.host}/`);
if (httpResponse.status !== 200 || httpResponse.url !== `${baseUrl.origin}/`) {
  errors.push(`HTTP canonical redirect failed (${httpResponse.status} ${httpResponse.url})`);
}

for (const asset of ["/style.css", "/site.js", "/favicon-64.png", "/favicon.png", "/favicon.ico"]) {
  const response = await fetchWithRetry(new URL(asset, baseUrl));
  if (response.status !== 200) errors.push(`${asset} returned ${response.status}`);
  if (asset.startsWith("/favicon") && !response.headers.get("content-type")?.startsWith("image/")) {
    errors.push(`${asset} returned an invalid content type`);
  }
}

const googlebotIconResponse = await fetchWithRetry(new URL("/favicon-64.png", baseUrl), {
  headers: { "user-agent": "Googlebot-Image/1.0" }
});
if (googlebotIconResponse.status !== 200) {
  errors.push(`Googlebot-Image favicon request returned ${googlebotIconResponse.status}`);
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`Production smoke test passed for ${urls.length} sitemap URLs.`);
