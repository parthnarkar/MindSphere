import React, { useEffect, useState, useRef, useCallback } from "react";
import { API } from "../hooks/helper";
import { auth } from "../firebase";

// Small debounce helper
const debounce = (fn, wait = 350) => {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
};

const FALLBACK = [
  { id: 1, title: "Intro to coping skills", type: "video", language: "English", url: "https://www.youtube.com/results?search_query=coping+skills" },
  { id: 2, title: "How to support a friend", type: "video", language: "Hindi", url: "https://www.youtube.com/results?search_query=how+to+support+a+friend" },
  { id: 3, title: "Offline resource map", type: "guide", language: "Regional", url: "" },
];

// Curated free and open resources (static) shown alongside search results
const OPEN_SOURCE = [
  { id: "who", title: "WHO — Mental health information", type: "guide", url: "https://www.who.int/health-topics/mental-health" },
  { id: "nimh", title: "NIMH — Mental Health Resources", type: "guide", url: "https://www.nimh.nih.gov/health" },
  { id: "mentalhealthgov", title: "MentalHealth.gov — Guides & help", type: "guide", url: "https://www.mentalhealth.gov/" },
  { id: "openlibrary", title: "OpenLibrary — Search books", type: "books", url: "https://openlibrary.org/" },
  { id: "wikipedia", title: "Wikipedia — Trusted overview articles", type: "articles", url: "https://en.wikipedia.org/" },
  { id: "mha", title: "Mental Health America — Tools & screenings", type: "guide", url: "https://mhanational.org/" },
];

export default function Resources() {
  // Search state
  const [query, setQuery] = useState("");
  const [suggestions] = useState([
    "coping skills",
    "how to support a friend",
    "managing anxiety",
    "depression help",
    "mindfulness exercises",
    "sleep hygiene",
    "crisis resources",
  ]);

  // Results state
  const [ytResults, setYtResults] = useState([]);
  const [wikiResults, setWikiResults] = useState([]);
  const [bookResults, setBookResults] = useState([]);
  const [localResources, setLocalResources] = useState([]);
  const [openSourceList] = useState(OPEN_SOURCE);

  // Error
  const [error, setError] = useState(null);

  const controllerRef = useRef(null);
  const cacheRef = useRef(new Map());

  // UI / pagination state
  const [activeFilter, setActiveFilter] = useState("all");
  const [ytLimit, setYtLimit] = useState(9);
  const [bookLimit, setBookLimit] = useState(6);

  // Use Vite env vars for YouTube API, allow overriding via variables
  const YT_KEY = import.meta.env.VITE_YT_API_KEY || null;

  // Accent colors (primary, darker hover, and light background)
  const ACCENT = "#263238"; // primary accent (dark slate)
  const ACCENT_DARK = "#1b2b2d"; // slightly darker variant for subtle emphasis
  const ACCENT_LIGHT = "#faf3ef"; // very light background shade
  const ACCENT_HOVER = "#374151"; // hover / stronger shade

  // Debounced search function with in-memory caching and partial-result rendering
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const doSearch = useCallback(
    debounce(async (q) => {
      if (!q || q.trim().length < 2) {
        // clear results for small queries
        setYtResults([]);
        setWikiResults([]);
        setBookResults([]);
        return;
      }

  const key = `${q.trim().toLowerCase()}|v${ytLimit}|b${bookLimit}`;
      // Return cached results immediately if present
      if (cacheRef.current.has(key)) {
        const cached = cacheRef.current.get(key);
        setYtResults(cached.ytResults || []);
        setWikiResults(cached.wikiResults || []);
        setBookResults(cached.bookResults || []);
        setLocalResources(cached.localResources || []);
        return;
      }

  setError(null);

      // NOTE: Recording of searches is intentionally moved to the explicit
      // user action (form submit / Search button) so we don't save every
      // partial/debounced query. The submit handler calls `recordSearch`.

      // Cancel previous fetches
      if (controllerRef.current) controllerRef.current.abort();
      controllerRef.current = new AbortController();

      const signal = controllerRef.current.signal;

      try {
        // Build fetch promises but handle each result as it arrives to render incrementally
        const base = API;

        // Track partial results to update cache incrementally
        const partial = { ytResults: [], wikiResults: [], bookResults: [], localResources: [] };

        // YouTube
        let ytPromise;
        if (YT_KEY) {
          const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${ytLimit}&q=${encodeURIComponent(q)}&key=${YT_KEY}`;
          ytPromise = fetch(ytUrl, { signal })
            .then((r) => (r.ok ? r.json() : Promise.reject(r)))
            .then((ytResp) => {
              const ytItems = (ytResp && ytResp.items) || [];
              const mappedYt = ytItems.map((it) => ({
                id: it.id.videoId || (it.id && it.id.videoId) || Math.random().toString(36).slice(2, 9),
                title: it.snippet?.title || "Untitled",
                channel: it.snippet?.channelTitle || "",
                thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || "",
              }));
              partial.ytResults = mappedYt;
              setYtResults(mappedYt);
              return mappedYt;
            })
            .catch(() => {
              partial.ytResults = [];
              setYtResults([]);
            });
        } else {
          ytPromise = Promise.resolve([]).then((arr) => { partial.ytResults = []; setYtResults([]); return []; });
        }

        // Wikipedia
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(q)}&utf8=&format=json&origin=*`;
        const wikiPromise = fetch(wikiUrl, { signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(r)))
          .then((wikiResp) => {
            const wikiItems = (wikiResp?.query?.search || []).slice(0, 6).map((s) => ({
              id: s.pageid,
              title: s.title,
              snippet: s.snippet.replace(/<\/?span[^>]*>/g, ""),
              url: `https://en.wikipedia.org/?curid=${s.pageid}`,
            }));
            partial.wikiResults = wikiItems;
            setWikiResults(wikiItems);
            return wikiItems;
          })
          .catch(() => { partial.wikiResults = []; setWikiResults([]); });

        // OpenLibrary books
        const booksUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${bookLimit}`;
        const booksPromise = fetch(booksUrl, { signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(r)))
          .then((booksResp) => {
            const bookDocs = (booksResp?.docs || []).slice(0, 6).map((b) => ({
              id: b.key,
              title: b.title,
              author: (b.author_name && b.author_name.join(", ")) || "",
              year: b.first_publish_year || "",
              cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null,
            }));
            partial.bookResults = bookDocs;
            setBookResults(bookDocs);
            return bookDocs;
          })
          .catch(() => { partial.bookResults = []; setBookResults([]); });

        // Local resources
        const localUrl = `${base.replace(/\/$/, "")}/api/resources?query=${encodeURIComponent(q)}`;
        const localPromise = fetch(localUrl, { signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(r)))
          .then((localResp) => {
            const local = (localResp?.resources || localResp) || [];
            partial.localResources = Array.isArray(local) ? local : [];
            setLocalResources(Array.isArray(local) ? local : []);
            return partial.localResources;
          })
          .catch(() => { partial.localResources = []; setLocalResources([]); });

        // Wait for all to settle so we can update loading flag and final cache
        const settled = await Promise.allSettled([ytPromise, wikiPromise, booksPromise, localPromise]);

        // Save combined cache entry
        try {
          cacheRef.current.set(key, {
            ytResults: partial.ytResults,
            wikiResults: partial.wikiResults,
            bookResults: partial.bookResults,
            localResources: partial.localResources,
          });
          if (cacheRef.current.size > 80) {
            const firstKey = cacheRef.current.keys().next().value;
            cacheRef.current.delete(firstKey);
          }
        } catch (err) {
          // ignore cache errors
        }

        } catch (err) {
            if (err.name === "AbortError") return; // user typed again
            console.error(err);
            setError(err.message || "Search failed");
          }
    }, 450),
    [YT_KEY, ytLimit, bookLimit]
  );

  // Only clear results when user clears the query. Actual search is performed
  // only when the user submits the form (onSubmit -> doSearch).
  useEffect(() => {
    if (!query || query.trim().length === 0) {
      setYtResults([]);
      setWikiResults([]);
      setBookResults([]);
      setLocalResources([]);
      setError(null);
    }
  }, [query]);

  // Record an explicit, user-initiated search event to the server.
  // This is called only when the user submits the search (clicks Search or presses Enter).
  const recordSearch = async (q) => {
    // Do not record empty queries
    if (!q || String(q).trim().length === 0) return;
    try {
      const base = API;
      const payload = {
        email: auth?.currentUser?.email || null,
        query: q,
        context: { source: 'resource_finder' },
      };
      // fire-and-forget; don't block the UI if recording fails
      await fetch(`${base.replace(/\/$/, '')}/api/resource-searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // silently ignore recording errors
    }
  };

  const onSubmit = (e) => {
    e.preventDefault();
    // Manual submit triggers an explicit recording, then an immediate search
    try {
      // don't await to keep UX snappy
      if (query && String(query).trim().length > 0) recordSearch(query);
    } catch (err) {
      // ignore
    }
    doSearch(query);
  };

  const loadMore = (type) => {
    if (type === "videos") {
      setYtLimit((s) => Math.min(25, s + 9));
    }
    if (type === "books") {
      setBookLimit((s) => Math.min(40, s + 12));
    }
    // trigger a fresh search instantly (debounced function will run after 450ms)
    doSearch(query);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-24">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
  <div className="rounded-3xl shadow-xl overflow-hidden" style={{ background: `linear-gradient(135deg, ${ACCENT_LIGHT}, #FFF8F5)` }}>
          <div className="p-6 sm:p-8">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold" style={{ color: ACCENT }}>Resource Finder</h1>
                <p className="mt-1 text-sm" style={{ color: ACCENT }}>Search videos, articles, books, local support and curated open/free resources.</p>
              </div>

              <form onSubmit={onSubmit} className="w-full lg:w-1/2">
                <label htmlFor="resource-search" className="sr-only">Search resources</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none" style={{ color: ACCENT }}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
                  </span>
                    <input
                      id="resource-search"
                      className="w-full pl-10 pr-28 py-2 border-0 rounded-full shadow-md focus:ring-2 focus:outline-none bg-white"
                      // Tailwind arbitrary focus ring for accent color (works with JIT)
                      style={{ caretColor: ACCENT }}
                      onFocus={(e) => e.currentTarget.classList.add('focus:ring-[#FF8C42]')}
                      onBlur={(e) => e.currentTarget.classList.remove('focus:ring-[#FF8C42]')}
                    placeholder="e.g. coping with anxiety"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search resources"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center gap-2 pr-2">
                    {query && (
                      <button type="button" onClick={() => setQuery("")} className="text-sm px-3 py-1 rounded-full hover:bg-[#0000000a] cursor-pointer" style={{ color: ACCENT }}>Clear</button>
                    )}
                    <button type="submit" className="px-4 py-1.5 rounded-full cursor-pointer text-white" style={{ background: ACCENT }} onMouseOver={(e) => (e.currentTarget.style.background = ACCENT_HOVER)} onMouseOut={(e) => (e.currentTarget.style.background = ACCENT)}>Search</button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => setQuery(s)}
                      className="text-xs md:text-sm px-3 py-1 rounded-full bg-white/80 hover:bg-black/10 shadow-sm cursor-pointer"
                      style={{ color: ACCENT }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </form>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 sm:p-8" style={{ background: ACCENT_LIGHT }}>
            <main className="lg:col-span-2 space-y-6">
              {(activeFilter === 'all' || activeFilter === 'videos') && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold" style={{ color: ACCENT }}>YouTube Videos</h2>
                  <div className="text-sm" style={{ color: ACCENT }}>{!YT_KEY ? <span className="text-yellow-600">YouTube API key not set</span> : `${ytResults.length} results`}</div>
                </div>

                <div className="bg-white p-4 rounded-lg shadow-sm">
                  {error && <div className="text-sm text-red-600">{error}</div>}

                  {!YT_KEY && (
                    <div className="text-sm" style={{ color: ACCENT }}>Set <code>VITE_YT_API_KEY</code> in <code>client/.env</code> to enable YouTube search.</div>
                  )}

                  {YT_KEY && ytResults.length === 0 && (
                    <div className="text-sm text-gray-500">No videos found — try a different query.</div>
                  )}

                  {ytResults.length > 0 && (
                    <div className="grid gap-4 md:grid-cols-2">
                      {ytResults.map((v) => (
                        <a key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="flex gap-3 p-3 rounded-lg border hover:shadow-md transition bg-white">
                          <div className="relative w-28 h-20 flex-shrink-0 rounded overflow-hidden bg-gray-50">
                            {v.thumbnail ? (
                              <img src={v.thumbnail} alt="thumb" className="w-full h-full object-cover" />
                            ) : (
                              <div className="w-full h-full bg-gray-100" />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="rounded-full p-2" style={{ background: ACCENT, opacity: 0.6 }}>
                                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                              </div>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="font-medium line-clamp-2" style={{ color: ACCENT }}>{v.title}</div>
                            <div className="text-xs mt-1" style={{ color: ACCENT }}>{v.channel}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}

                  {ytResults.length > 0 && YT_KEY && (
                    <div className="mt-3 text-right">
                      <button onClick={() => loadMore("videos")} className="text-sm px-3 py-1 rounded-full text-white" style={{ background: ACCENT }} onMouseOver={(e) => (e.currentTarget.style.background = ACCENT_DARK)} onMouseOut={(e) => (e.currentTarget.style.background = ACCENT)}>Load more videos</button>
                    </div>
                  )}
                </div>
              </section>
              )}

              {(activeFilter === 'all' || activeFilter === 'articles') && (
              <section>
                <h2 className="text-lg font-semibold mb-3" style={{ color: ACCENT }}>Wikipedia Articles</h2>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  {wikiResults.length === 0 ? (
                    <div className="text-sm" style={{ color: ACCENT }}>No articles found.</div>
                  ) : (
                    <ul className="space-y-3">
                      {wikiResults.map((w) => (
                        <li key={w.id} className="p-3 rounded border hover:bg-[#FFF4EE]">
                          <a href={w.url} target="_blank" rel="noreferrer" className="font-medium hover:underline" style={{ color: ACCENT }}>
                            {w.title}
                          </a>
                          <div className="text-sm mt-1" style={{ color: ACCENT }} dangerouslySetInnerHTML={{ __html: w.snippet }} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
              )}

              {(activeFilter === 'all' || activeFilter === 'books') && (
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold" style={{ color: ACCENT }}>Books (OpenLibrary)</h2>
                  <div className="text-sm" style={{ color: ACCENT }}>{bookResults.length} results</div>
                </div>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  {bookResults.length === 0 ? (
                    <div className="text-sm" style={{ color: ACCENT }}>No books found.</div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {bookResults.map((b) => (
                        <div key={b.id} className="flex gap-3 items-start border p-3 rounded hover:shadow-sm bg-white">
                          {b.cover ? (
                            <img src={b.cover} className="w-20 h-28 object-cover rounded" alt={b.title} />
                          ) : (
                            <div className="w-20 h-28 rounded flex items-center justify-center text-xs" style={{ background: ACCENT_LIGHT, color: ACCENT }}>No cover</div>
                          )}
                          <div>
                            <div className="font-medium" style={{ color: ACCENT }}>{b.title}</div>
                            <div className="text-sm" style={{ color: ACCENT }}>{b.author}</div>
                            <div className="text-xs" style={{ color: ACCENT }}>{b.year}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {bookResults.length > 0 && (
                    <div className="mt-3 text-right">
                      <button onClick={() => loadMore("books")} className="text-sm px-3 py-1 rounded-full text-white" style={{ background: ACCENT }} onMouseOver={(e) => (e.currentTarget.style.background = ACCENT_DARK)} onMouseOut={(e) => (e.currentTarget.style.background = ACCENT)}>Load more books</button>
                    </div>
                  )}
                </div>
              </section>
              )}
            </main>
            
            <aside className="space-y-6">
              <div className="bg-white p-4 rounded-lg shadow-sm">
                <h3 className="text-md font-semibold mb-2" style={{ color: ACCENT }}>Filters</h3>
                <div className="flex flex-wrap gap-2">
                  {[
                    ["all", "All"],
                    ["videos", "Videos"],
                    ["articles", "Articles"],
                    ["books", "Books"],
                  ].map(([key, label]) => (
                    <button
                      key={key}
                      onClick={() => setActiveFilter(key)}
                      className={`text-sm px-3 py-1 rounded-full cursor-pointer hover:bg-[#263238]/10 ${activeFilter === key ? 'text-white' : 'bg-white border'}`}
                      style={activeFilter === key ? { background: ACCENT } : { color: ACCENT }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="bg-white p-4 rounded-lg shadow-sm">
                <h3 className="text-md font-semibold mb-2" style={{ color: ACCENT }}>Curated open & free resources</h3>
                <ul className="space-y-2">
                  {openSourceList.map((o) => (
                    <li key={o.id} className="p-2 rounded border hover:bg-[#FFF4EE]">
                      <a href={o.url} target="_blank" rel="noreferrer" className="font-medium" style={{ color: ACCENT }}>{o.title}</a>
                      <div className="text-xs" style={{ color: ACCENT }}>{o.type}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}

// Notify top-level that Resources is ready on mount (no blocking async init)
try {
  // Use a microtask so this file's module evaluation doesn't throw in older browsers
  if (typeof window !== 'undefined') {
    window.requestAnimationFrame(() => {
      try { window.dispatchEvent(new CustomEvent('mindsphere:pageReady')); } catch(e) {}
    });
  }
} catch(e) {}