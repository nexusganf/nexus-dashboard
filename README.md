# NEXUS — Gaming & Anime News Dashboard

A single-page, live news dashboard for gamers and anime fans. It aggregates **gaming news,
anime & manga, deals & giveaways, and trailers/video** from free public RSS feeds — no API keys,
no accounts, no backend.

## Run it

**Easiest:** double-click `index.html` to open it in your browser.

**Recommended (proper origin, fewer proxy quirks):**

```bash
npx serve .
# then open the printed http://localhost:3000
```

Any static file server works (`python -m http.server`, VS Code Live Server, etc.).

## How it works

News is **prefetched server-side**, not fetched by every visitor's browser. A GitHub Action
runs every 15 minutes, fetches all feeds directly (no CORS issue server-side, no proxy needed),
and commits the result to `news.json`. The page just loads that file — typically in a few
milliseconds, since it's a small static JSON file on the same origin.

- `index.html` – page shell (header, tabs, search, grid)
- `styles.css` – dark neon theme, responsive card grid
- `feeds.js` – **the list of news sources** (edit this to customize; shared by the browser and
  the prefetch script)
- `scripts/fetch-news.js` – Node script that fetches every feed and writes `news.json`
- `.github/workflows/update-news.yml` – runs the script every 15 minutes and commits the result
- `news.json` – the prefetched data the page actually loads (auto-generated, don't hand-edit)
- `app.js` – loads `news.json`, de-duplicates (by normalized title, so the same story reported
  by multiple outlets collapses), sorts newest-first, and renders cards. Also caches the last
  good result in `localStorage` so a reload paints instantly even before the network request
  resolves. Auto-refreshes every 15 minutes, or hit **Refresh**.

Each category is anchored by a **Google News** query feed, which is far more reliable than
Reddit/YouTube for this kind of fetching, so no category goes empty even if a couple of sources
have a bad day. Reddit/YouTube are included as bonus sources.

**Fallback:** if `news.json` is ever missing or empty (e.g. you open `index.html` directly via
`file://` before the site has been deployed, so the browser can't fetch a sibling file), the app
automatically falls back to fetching all feeds live in the browser through public CORS proxies —
the original approach, slower and less reliable, but it means the site still works standalone.

## Updating the news data

Locally: `node scripts/fetch-news.js` (needs Node 18+, no npm install required — it only uses
built-ins). On the deployed site, this runs automatically via GitHub Actions every 15 minutes;
you can also trigger it manually from the repo's **Actions** tab → "Update news feed" →
**Run workflow**.

## Add or remove news sources

Edit `feeds.js` — each source is one line:

```js
{ name: "IGN", category: "gaming", url: "https://www.ign.com/rss/articles" },
```

- `category` must be one of: `gaming`, `anime`, `deals`, `trailers`
- `url` is any public RSS/Atom feed
- Reddit: append `.rss` to a subreddit → `https://www.reddit.com/r/SUBREDDIT/.rss`
- YouTube channel: `https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID`

## Advertisements

The layout has built-in ad slots: a leaderboard banner under the tabs and an in-feed ad card
every 10 stories. They show themed placeholders until you connect Google AdSense:

1. Get a custom domain (~$10/yr) — AdSense generally rejects free subdomains like
   `username.github.io`.
2. Apply at [adsense.google.com](https://adsense.google.com) with your domain (approval can
   take days–weeks and requires original content policies — review their program policies).
3. Paste your publisher ID (`ca-pub-…`) into `ads.js` → `adsenseClient`. Done — real ads
   replace the placeholders automatically.

Tune placement in `ads.js` (`gridFrequency`, per-slot IDs, or `enabled: false` to hide ads).

## Host it for free

It's a static site — drag the folder onto **Netlify Drop**, push to **GitHub Pages**, or deploy to
**Cloudflare Pages**. No build step required.

## Note on reliability

Because fetching happens server-side in GitHub Actions (not through public CORS proxies), it's
far more reliable than browser-side fetching — no per-visitor rate limits, and sites like Reddit
that often block proxies work fine with a direct server request. The live in-browser fallback
still exists for the `file://` case, and inherits the same proxy caveats described in its own
code comments.
