#!/usr/bin/env node
// scripts/fetch-news.js — fetches every feed in feeds.js directly (no CORS proxy needed
// server-side) and writes news.json. Run on a schedule by .github/workflows/update-news.yml
// so the site loads pre-fetched news instantly instead of every visitor's browser hitting
// public proxies live.

const fs = require("fs");
const path = require("path");
const { FEEDS } = require("../feeds.js");

const PER_FEED_MAX = 25;
const CONCURRENCY = 6;
const TIMEOUT_MS = 15000;
const OUTPUT_PATH = path.join(__dirname, "..", "news.json");
const USER_AGENT = "Mozilla/5.0 (compatible; NexusNewsBot/1.0; +https://github.com/nexusganf/nexus-dashboard)";

// ---- tiny regex-based RSS/Atom parser (no DOM available in Node) ----------------

function decodeEntities(s = "") {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, "&");
}

const stripTags = (html = "") => decodeEntities(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

function pickTag(block, tags) {
  for (const t of tags) {
    const m = block.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)<\\/${t}>`, "i"));
    if (m && m[1] && m[1].trim()) return decodeEntities(m[1]).trim();
  }
  return "";
}

function pickLink(block) {
  const text = pickTag(block, ["link"]);
  if (text && /^https?:/i.test(text)) return text;
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (any) return any[1];
  return text;
}

function extractThumb(block, descHtml) {
  const patterns = [
    /<media:thumbnail[^>]*url=["']([^"']+)["']/i,
    /<media:content[^>]*url=["']([^"']+)["'][^>]*medium=["']image["']/i,
    /<media:content[^>]*medium=["']image["'][^>]*url=["']([^"']+)["']/i,
    /<media:content[^>]*url=["']([^"']+)["']/i,
    /<enclosure[^>]*url=["']([^"']+)["'][^>]*type=["']image[^"']*["']/i,
    /<enclosure[^>]*type=["']image[^"']*["'][^>]*url=["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = block.match(re);
    if (m) return m[1];
  }
  if (descHtml) {
    const im = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (im) return im[1];
  }
  return null;
}

function parseFeedXml(xml, feed) {
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  const out = [];
  for (const block of blocks.slice(0, PER_FEED_MAX)) {
    const title = stripTags(pickTag(block, ["title"])) || "(untitled)";
    const link = (pickLink(block) || "").trim();
    const descHtml = pickTag(block, ["content:encoded", "content", "description", "summary"]);
    const dateStr = pickTag(block, ["pubDate", "published", "updated", "dc:date", "date"]);
    const date = dateStr ? new Date(dateStr) : null;
    const valid = date && !isNaN(date);
    const thumb = extractThumb(block, descHtml);

    out.push({
      title,
      link,
      source: feed.name,
      category: feed.category,
      summary: stripTags(descHtml).slice(0, 220),
      thumbnail: thumb && /^https?:/i.test(thumb) ? thumb : null,
      ts: valid ? date.getTime() : 0,
    });
  }
  return out;
}

// Google News titles look like "Real headline - Publisher". Split it out.
function refineItems(items, feed) {
  if (!/google news/i.test(feed.name)) return items;
  return items.map((it) => {
    const idx = it.title.lastIndexOf(" - ");
    if (idx > 20 && idx > it.title.length - 45) {
      return { ...it, source: it.title.slice(idx + 3).trim(), title: it.title.slice(0, idx).trim() };
    }
    return it;
  });
}

// ---- fetching ---------------------------------------------------------------

async function fetchFeed(feed) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text || !text.includes("<")) throw new Error("empty response");
    return refineItems(parseFeedXml(text, feed), feed);
  } finally {
    clearTimeout(t);
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try { results[i] = { status: "fulfilled", value: await fn(items[i]) }; }
      catch (e) { results[i] = { status: "rejected", reason: e }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log(`Fetching ${FEEDS.length} feeds…`);
  const results = await mapWithConcurrency(FEEDS, CONCURRENCY, fetchFeed);

  const items = [];
  const offlineSources = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") {
      items.push(...r.value);
      console.log(`  ok    ${FEEDS[i].name} (${r.value.length} items)`);
    } else {
      offlineSources.push(FEEDS[i].name);
      console.log(`  FAIL  ${FEEDS[i].name} — ${r.reason.message || r.reason}`);
    }
  });

  // De-duplicate by normalized title (collapses the same story from multiple outlets /
  // Google News regional editions).
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const seen = new Map();
  for (const it of items) {
    const key = norm(it.title) || it.link;
    if (!seen.has(key)) seen.set(key, it);
  }
  const deduped = [...seen.values()].sort((a, b) => b.ts - a.ts);

  if (deduped.length === 0) {
    console.error("No stories fetched from any source — leaving the previous news.json in place.");
    process.exit(1);
  }

  const output = {
    generatedAt: new Date().toISOString(),
    sourcesTotal: FEEDS.length,
    sourcesOk: FEEDS.length - offlineSources.length,
    offlineSources,
    items: deduped,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output));
  console.log(`\nWrote ${deduped.length} stories from ${output.sourcesOk}/${output.sourcesTotal} sources to ${OUTPUT_PATH}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
