// feeds.js — the single place to configure news sources.
// To add a source: copy a line and change the fields. To remove one: delete its line.
//
// category must be one of: "gaming", "anime", "deals", "trailers" (matches the UI tabs).
//
// RELIABILITY NOTE: feeds are fetched in the browser through free public proxies, so the
// most reliable sources are standard news RSS and Google News. Reddit and YouTube feeds are
// often blocked by proxies, so they're included only as *bonus* sources — every category is
// anchored by a Google News query feed that keeps working even when the others don't.
//
// Google News works for ANY topic — just change the q= query:
//   https://news.google.com/rss/search?q=YOUR+QUERY&hl=en-US&gl=US&ceid=US:en
// Reddit:   https://www.reddit.com/r/SUBREDDIT/.rss
// YouTube:  https://www.youtube.com/feeds/videos.xml?channel_id=CHANNEL_ID

const FEEDS = [
  // ---------- Gaming news ----------
  { name: "Google News · Gaming", category: "gaming", url: "https://news.google.com/rss/search?q=video+game+news&hl=en-US&gl=US&ceid=US:en" },
  { name: "Polygon",              category: "gaming", url: "https://www.polygon.com/rss/index.xml" },
  { name: "VG247",                category: "gaming", url: "https://www.vg247.com/feed" },
  { name: "Gematsu",              category: "gaming", url: "https://www.gematsu.com/feed" },
  { name: "Eurogamer",            category: "gaming", url: "https://www.eurogamer.net/feed" },
  { name: "PC Gamer",             category: "gaming", url: "https://www.pcgamer.com/rss/" },
  { name: "GameSpot",             category: "gaming", url: "https://www.gamespot.com/feeds/news/" },
  { name: "Kotaku",               category: "gaming", url: "https://kotaku.com/rss" },

  // ---------- Anime & manga ----------
  { name: "Google News · Anime",  category: "anime",  url: "https://news.google.com/rss/search?q=anime+OR+manga+news&hl=en-US&gl=US&ceid=US:en" },
  { name: "Anime News Network",   category: "anime",  url: "https://www.animenewsnetwork.com/all/rss.xml" },
  { name: "Siliconera",           category: "anime",  url: "https://www.siliconera.com/feed/" },
  { name: "Anime Corner",         category: "anime",  url: "https://animecorner.me/feed/" },
  { name: "MyAnimeList News",     category: "anime",  url: "https://myanimelist.net/rss/news.xml" },

  // ---------- Deals & giveaways ----------
  { name: "Google News · Deals",  category: "deals",  url: "https://news.google.com/rss/search?q=%22video+game+deals%22+OR+%22game+sale%22&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News · Free Games", category: "deals", url: "https://news.google.com/rss/search?q=free+game+epic+OR+steam+OR+giveaway&hl=en-US&gl=US&ceid=US:en" },
  { name: "r/GameDeals",          category: "deals",  url: "https://www.reddit.com/r/GameDeals/.rss" }, // bonus (proxy-permitting)

  // ---------- Trailers & video ----------
  { name: "Google News · Trailers",   category: "trailers", url: "https://news.google.com/rss/search?q=game+trailer+reveal+OR+gameplay+trailer&hl=en-US&gl=US&ceid=US:en" },
  { name: "Google News · Anime PV",   category: "trailers", url: "https://news.google.com/rss/search?q=anime+trailer+OR+%22new+anime%22+announced&hl=en-US&gl=US&ceid=US:en" },
  { name: "IGN (YouTube)",            category: "trailers", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCKy1dAqELo0zrOtPkf0eTMw" }, // bonus
  { name: "GameSpot (YouTube)",       category: "trailers", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbu2SsF-Or3Rsn3NxqODImw" }, // bonus
];

// Display metadata for each category (label + emoji shown on the tabs).
const CATEGORIES = [
  { id: "all",      label: "All",              emoji: "✨" },
  { id: "gaming",   label: "Gaming",           emoji: "🎮" },
  { id: "anime",    label: "Anime & Manga",    emoji: "🎌" },
  { id: "deals",    label: "Deals & Giveaways",emoji: "💰" },
  { id: "trailers", label: "Trailers & Video", emoji: "🎬" },
];

// Expose to the browser (script tag) or Node (require), whichever is loading this file.
if (typeof window !== "undefined") { window.FEEDS = FEEDS; window.CATEGORIES = CATEGORIES; }
if (typeof module !== "undefined" && module.exports) { module.exports = { FEEDS, CATEGORIES }; }
