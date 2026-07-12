/* app.js — fetch, parse, and render the news dashboard.
   No frameworks, no build step. Reads FEEDS + CATEGORIES from feeds.js. */

(() => {
  "use strict";

  // ---- Config ----------------------------------------------------------------
  // Feeds are fetched through public proxies (browsers block direct RSS due to CORS).
  // We try them in order until one succeeds. rss2json returns normalized JSON and is
  // the most reliable; the others return the raw XML which we parse ourselves.
  // "kind" tells the fetch layer how to interpret the response.
  const PROXIES = [
    { kind: "rss2json", build: (u) => `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(u)}` },
    { kind: "xml",      build: (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}` },
    { kind: "xml",      build: (u) => `https://api.codetabs.com/v1/proxy/?quest=${encodeURIComponent(u)}` },
    { kind: "json-wrap",build: (u) => `https://api.allorigins.win/get?url=${encodeURIComponent(u)}` },
  ];
  const FETCH_TIMEOUT_MS = 9000;   // fail fast on dead proxies
  const CONCURRENCY = 4;           // limit parallel requests so proxies don't rate-limit us
  const CACHE_KEY = "nexus_news_cache_v1";
  const CACHE_TTL_MS = 15 * 60 * 1000;   // 15 minutes
  const AUTO_REFRESH_MS = 15 * 60 * 1000;
  const PER_FEED_MAX = 20;               // cap items per feed
  // news.json is prefetched server-side every ~15 min by .github/workflows/update-news.yml
  // (see scripts/fetch-news.js). Loading it is instant and needs no proxy. The live
  // multi-proxy fetch below only runs as a fallback if news.json is missing or empty
  // (e.g. opened via file:// before ever being deployed, or the very first commit).
  const NEWS_JSON_URL = "news.json";

  // ---- State -----------------------------------------------------------------
  let allItems = [];
  let activeCategory = "all";
  let query = "";

  // ---- DOM -------------------------------------------------------------------
  const el = {
    tabs:    document.getElementById("tabs"),
    grid:    document.getElementById("grid"),
    status:  document.getElementById("status"),
    empty:   document.getElementById("empty"),
    search:  document.getElementById("search"),
    refresh: document.getElementById("refresh"),
  };

  const CAT_LABEL = Object.fromEntries(
    (window.CATEGORIES || []).map((c) => [c.id, c.label])
  );

  // ---- Utilities -------------------------------------------------------------
  const escapeHtml = (s = "") =>
    s.replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const stripHtml = (html = "") => {
    const d = document.createElement("div");
    d.innerHTML = html;
    return (d.textContent || d.innerText || "").replace(/\s+/g, " ").trim();
  };

  function timeAgo(date) {
    if (!date) return "";
    const s = Math.floor((Date.now() - date.getTime()) / 1000);
    if (s < 60) return "just now";
    const units = [["y", 31536000], ["mo", 2592000], ["d", 86400], ["h", 3600], ["m", 60]];
    for (const [label, secs] of units) {
      const v = Math.floor(s / secs);
      if (v >= 1) return `${v}${label} ago`;
    }
    return "just now";
  }

  // Pull the first usable image URL out of a feed entry.
  function extractThumb(item, descHtml) {
    const pick = (sel, attr) => {
      const n = item.querySelector(sel);
      return n ? n.getAttribute(attr) : null;
    };
    // media:thumbnail / media:content (namespaced -> match by local name)
    const media =
      item.querySelector('thumbnail, [url][medium="image"], content[url]') ||
      [...item.getElementsByTagName("*")].find(
        (n) => /(^|:)(thumbnail|content)$/.test(n.nodeName) && n.getAttribute("url")
      );
    if (media && media.getAttribute("url")) return media.getAttribute("url");

    const enc = pick("enclosure", "url");
    if (enc && /^https?:/.test(enc)) return enc;

    // First <img> inside the description/content HTML
    if (descHtml) {
      const m = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) return m[1];
    }
    return null;
  }

  function getText(node, ...names) {
    for (const name of names) {
      const n = node.querySelector(name) || node.getElementsByTagName(name)[0];
      if (n && n.textContent.trim()) return n.textContent.trim();
    }
    return "";
  }

  // ---- Parsing ---------------------------------------------------------------
  function parseFeed(xmlText, feed) {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    if (doc.querySelector("parsererror")) throw new Error("XML parse error");

    const nodes = [...doc.querySelectorAll("item"), ...doc.querySelectorAll("entry")];
    const out = [];

    for (const node of nodes.slice(0, PER_FEED_MAX)) {
      // Link: RSS <link>text</link> or Atom <link href="">
      let link = getText(node, "link");
      if (!link) {
        const l = node.querySelector("link");
        if (l) link = l.getAttribute("href") || "";
      }

      const title = stripHtml(getText(node, "title")) || "(untitled)";
      const descHtml =
        getText(node, "encoded") ||          // content:encoded
        getText(node, "content") ||          // Atom content
        getText(node, "description") ||
        getText(node, "summary") || "";
      const dateStr = getText(node, "pubDate", "published", "updated", "date");
      const date = dateStr ? new Date(dateStr) : null;

      out.push({
        title,
        link,
        source: feed.name,
        category: feed.category,
        summary: stripHtml(descHtml).slice(0, 220),
        thumbnail: extractThumb(node, descHtml),
        date: date && !isNaN(date) ? date : null,
        ts: date && !isNaN(date) ? date.getTime() : 0,
      });
    }
    return out;
  }

  // Parse the JSON that rss2json returns (already normalized).
  function parseRss2Json(json, feed) {
    if (!json || json.status !== "ok" || !Array.isArray(json.items)) {
      throw new Error(json && json.message ? json.message : "rss2json error");
    }
    return json.items.slice(0, PER_FEED_MAX).map((it) => {
      const descHtml = it.content || it.description || "";
      let thumb = it.thumbnail || (it.enclosure && it.enclosure.link) || null;
      if (!thumb && descHtml) {
        const m = descHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
        if (m) thumb = m[1];
      }
      const date = it.pubDate ? new Date(it.pubDate) : null;
      return {
        title: stripHtml(it.title) || "(untitled)",
        link: it.link || "",
        source: feed.name,
        category: feed.category,
        summary: stripHtml(descHtml).slice(0, 220),
        thumbnail: thumb && /^https?:/.test(thumb) ? thumb : null,
        date: date && !isNaN(date) ? date : null,
        ts: date && !isNaN(date) ? date.getTime() : 0,
      };
    });
  }

  // ---- Fetching --------------------------------------------------------------
  function fetchWithTimeout(url) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    return fetch(url, { cache: "no-store", signal: ctrl.signal }).finally(() => clearTimeout(t));
  }

  // Google News titles look like "Real headline - Publisher". Pull the publisher out
  // into the source label and clean the title.
  function refineItems(items, feed) {
    const isGNews = /google news/i.test(feed.name);
    if (!isGNews) return items;
    return items.map((it) => {
      const idx = it.title.lastIndexOf(" - ");
      if (idx > 20 && idx > it.title.length - 45) {
        return { ...it, source: it.title.slice(idx + 3).trim(), title: it.title.slice(0, idx).trim() };
      }
      return it;
    });
  }

  // Try each proxy until one yields usable items for this feed.
  async function fetchFeed(feed) {
    let lastErr;
    for (const proxy of PROXIES) {
      try {
        const res = await fetchWithTimeout(proxy.build(feed.url));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        let items;
        if (proxy.kind === "rss2json") {
          items = parseRss2Json(await res.json(), feed);
        } else if (proxy.kind === "json-wrap") {
          const wrapped = await res.json();          // allorigins /get -> { contents }
          const xml = wrapped && wrapped.contents;
          if (!xml || !xml.includes("<")) throw new Error("empty wrapped response");
          items = parseFeed(xml, feed);
        } else {
          const text = await res.text();             // raw XML
          if (!text || !text.includes("<")) throw new Error("empty response");
          items = parseFeed(text, feed);
        }
        return refineItems(items, feed);
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("all proxies failed");
  }

  // Run async tasks with a max concurrency so we don't hammer (and get rate-limited by)
  // the proxies. Preserves input order in the results array.
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

  // Live multi-proxy fetch — fallback path only, used when news.json isn't available.
  async function fetchAllLive() {
    setLoading(true);
    el.status.innerHTML = `Fetching ${window.FEEDS.length} sources…`;

    const results = await mapWithConcurrency(window.FEEDS, CONCURRENCY, (feed) => fetchFeed(feed));

    const items = [];
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === "fulfilled") items.push(...r.value);
      else failed.push(window.FEEDS[i].name);
    });

    if (items.length) {
      // De-duplicate by normalized title (collapses the same story reported by multiple
      // sources / Google News regional editions), falling back to link.
      const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      const seen = new Map();
      for (const it of items) {
        const key = norm(it.title) || (it.link || "").trim();
        if (!seen.has(key)) seen.set(key, it);
      }
      allItems = [...seen.values()].sort((a, b) => b.ts - a.ts);
      saveCache(allItems);
    }

    renderTabs();
    render();

    const okCount = window.FEEDS.length - failed.length;
    let msg = `Showing ${allItems.length} stories from ${okCount}/${window.FEEDS.length} sources · updated ${new Date().toLocaleTimeString()}`;
    if (failed.length) msg += ` <span class="err">· offline: ${escapeHtml(failed.join(", "))}</span>`;
    el.status.innerHTML = msg;
    setLoading(false);
  }

  // Primary path — instant, no proxy. Falls back to the live fetch above if news.json
  // is missing/empty (e.g. opened directly via file:// before ever being deployed).
  async function fetchNews() {
    try {
      const res = await fetch(`${NEWS_JSON_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!json || !Array.isArray(json.items) || !json.items.length) throw new Error("empty news.json");

      allItems = json.items.map((it) => ({ ...it, date: it.ts ? new Date(it.ts) : null }));
      saveCache(allItems);
      renderTabs();
      render();

      let msg = `Showing ${allItems.length} stories from ${json.sourcesOk}/${json.sourcesTotal} sources · feed generated ${timeAgo(new Date(json.generatedAt))}`;
      if (json.offlineSources && json.offlineSources.length) {
        msg += ` <span class="err">· offline: ${escapeHtml(json.offlineSources.join(", "))}</span>`;
      }
      el.status.innerHTML = msg;
      setLoading(false);
    } catch {
      await fetchAllLive();
    }
  }

  // ---- Cache -----------------------------------------------------------------
  function saveCache(items) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), items }));
    } catch { /* storage full / disabled — ignore */ }
  }
  function loadCache() {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      const { t, items } = JSON.parse(raw);
      items.forEach((it) => { it.date = it.ts ? new Date(it.ts) : null; });
      return { age: Date.now() - t, items };
    } catch { return null; }
  }

  // ---- Rendering -------------------------------------------------------------
  function setLoading(on) {
    el.refresh.classList.toggle("loading", on);
    el.refresh.disabled = on;
    if (on && !allItems.length) renderSkeletons();
  }

  function renderSkeletons() {
    el.grid.innerHTML = Array.from({ length: 8 }).map(() => `
      <div class="card skeleton">
        <div class="card-thumb"></div>
        <div class="card-body">
          <div class="sk-line short"></div>
          <div class="sk-line"></div>
          <div class="sk-line"></div>
          <div class="sk-line short"></div>
        </div>
      </div>`).join("");
    el.empty.classList.add("hidden");
  }

  function renderTabs() {
    el.tabs.innerHTML = (window.CATEGORIES || []).map((c) => {
      const n = c.id === "all"
        ? allItems.length
        : allItems.filter((it) => it.category === c.id).length;
      return `<button class="tab ${c.id === activeCategory ? "active" : ""}" data-cat="${c.id}">
        <span>${c.emoji}</span><span>${escapeHtml(c.label)}</span>
        <span class="count">${n}</span></button>`;
    }).join("");
  }

  function currentItems() {
    const q = query.toLowerCase();
    return allItems.filter((it) => {
      if (activeCategory !== "all" && it.category !== activeCategory) return false;
      if (q && !(`${it.title} ${it.summary} ${it.source}`.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function cardHtml(it) {
    const thumb = it.thumbnail
      ? `<img class="card-thumb" src="${escapeHtml(it.thumbnail)}" alt="" loading="lazy"
             onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'card-thumb placeholder',textContent:'🗞️'}))" />`
      : `<div class="card-thumb placeholder">🗞️</div>`;
    return `<a class="card" href="${escapeHtml(it.link)}" target="_blank" rel="noopener noreferrer">
      ${thumb}
      <div class="card-body">
        <div class="card-meta">
          <span class="pill ${it.category}">${escapeHtml(CAT_LABEL[it.category] || it.category)}</span>
        </div>
        <h3 class="card-title">${escapeHtml(it.title)}</h3>
        ${it.summary ? `<p class="card-summary">${escapeHtml(it.summary)}</p>` : ""}
        <div class="card-foot">
          <span class="source">${escapeHtml(it.source)}</span>
          <span>${escapeHtml(timeAgo(it.date))}</span>
        </div>
      </div>
    </a>`;
  }

  // ---- Ads (config in ads.js) ------------------------------------------------
  const adsEnabled = () => window.ADS && window.ADS.enabled !== false;
  const hasAdsense = () => adsEnabled() && !!window.ADS.adsenseClient;

  let adsenseScriptLoaded = false;
  function loadAdsenseScript() {
    if (adsenseScriptLoaded || !hasAdsense()) return;
    adsenseScriptLoaded = true;
    const s = document.createElement("script");
    s.async = true;
    s.crossOrigin = "anonymous";
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(window.ADS.adsenseClient)}`;
    document.head.appendChild(s);
  }

  // kind: "banner" (leaderboard under tabs) | "grid" (in-feed card)
  function adHtml(kind) {
    if (!adsEnabled()) return "";
    const wrap = kind === "grid" ? "card ad-card" : "";
    if (hasAdsense()) {
      const slot = (window.ADS.slots && window.ADS.slots[kind]) || "";
      return `<div class="ad-slot ${kind} ${wrap}">
        <span class="ad-label">Advertisement</span>
        <ins class="adsbygoogle" style="display:block"
             data-ad-client="${escapeHtml(window.ADS.adsenseClient)}"
             ${slot ? `data-ad-slot="${escapeHtml(slot)}"` : ""}
             data-ad-format="${kind === "banner" ? "horizontal" : "fluid"}"
             data-full-width-responsive="true"></ins>
      </div>`;
    }
    // No publisher ID yet — show a themed placeholder so the layout is visible.
    return `<div class="ad-slot ${kind} ${wrap} ad-placeholder">
      <span class="ad-label">Advertisement</span>
      <div class="ad-ph">
        <span class="ad-ph-icon">📢</span>
        <span class="ad-ph-text">Ad space — add your AdSense ID in <code>ads.js</code></span>
      </div>
    </div>`;
  }

  // AdSense requires a push() per <ins> after it's in the DOM.
  function activateAds(scope) {
    if (!hasAdsense()) return;
    loadAdsenseScript();
    scope.querySelectorAll("ins.adsbygoogle:not([data-init])").forEach((ins) => {
      ins.setAttribute("data-init", "1");
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch { /* not loaded yet */ }
    });
  }

  function renderBanner() {
    const banner = document.getElementById("ad-banner");
    if (!banner) return;
    banner.innerHTML = adHtml("banner");
    activateAds(banner);
  }

  function render() {
    const items = currentItems();
    el.empty.classList.toggle("hidden", items.length > 0);
    const freq = (window.ADS && window.ADS.gridFrequency) || 10;
    const parts = [];
    items.forEach((it, i) => {
      parts.push(cardHtml(it));
      if (adsEnabled() && (i + 1) % freq === 0) parts.push(adHtml("grid"));
    });
    el.grid.innerHTML = parts.join("");
    activateAds(el.grid);
  }

  // ---- Events ----------------------------------------------------------------
  el.tabs.addEventListener("click", (e) => {
    const btn = e.target.closest(".tab");
    if (!btn) return;
    activeCategory = btn.dataset.cat;
    renderTabs();
    render();
  });

  let searchTimer;
  el.search.addEventListener("input", (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { query = e.target.value.trim(); render(); }, 150);
  });

  el.refresh.addEventListener("click", () => {
    setLoading(true);
    fetchNews();
  });

  // ---- Boot ------------------------------------------------------------------
  function init() {
    renderTabs();
    renderBanner();
    const cached = loadCache();
    if (cached && cached.items.length) {
      allItems = cached.items;
      renderTabs();
      render();
      const mins = Math.round(cached.age / 60000);
      el.status.textContent = `Showing ${allItems.length} cached stories · updated ${mins}m ago · refreshing…`;
    } else {
      renderSkeletons();
    }
    // news.json is a same-origin static file, so this is cheap — always fetch it fresh
    // on load rather than gating on cache age.
    fetchNews();

    setInterval(fetchNews, AUTO_REFRESH_MS);
  }

  init();
})();
