import React, { useEffect, useState, useRef, useCallback } from "react";
import { API } from "../hooks/helper";

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

  // Loading & error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const controllerRef = useRef(null);

  // UI / pagination state
  const [activeFilter, setActiveFilter] = useState("all");
  const [ytLimit, setYtLimit] = useState(9);
  const [bookLimit, setBookLimit] = useState(6);

  // Use Vite env vars for YouTube API, allow overriding via variables
  const YT_KEY = import.meta.env.VITE_YT_API_KEY || null;

  // Accent colors (primary, darker hover, and light background)
  const ACCENT = "#263238";
  const ACCENT_DARK = "#ffffffff"; // hover / stronger shade
  const ACCENT_LIGHT = "#faf3efff"; // very light background shade
  const ACCENT_HOVER = "#4b4b4bff"; // hover / stronger shade --- IGNORE ---

  // Debounced search function
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

      setLoading(true);
      setError(null);

      // Cancel previous fetches
      if (controllerRef.current) controllerRef.current.abort();
      controllerRef.current = new AbortController();

      const signal = controllerRef.current.signal;

      try {
        // Parallel fetches: YouTube (search), Wikipedia, OpenLibrary, local resources
        const searchTasks = [];

        // YouTube search (client-side) — requires API key
        if (YT_KEY) {
          const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${ytLimit}&q=${encodeURIComponent(
            q
          )}&key=${YT_KEY}`;
          searchTasks.push(fetch(ytUrl, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(r))));
        } else {
          // If no key, keep results empty (we show a hint to set the key)
          searchTasks.push(Promise.resolve({ items: [] }));
        }

        // Wikipedia search (opensearch) — lightweight
        const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          q
        )}&utf8=&format=json&origin=*`;
        searchTasks.push(fetch(wikiUrl, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(r))));

        // OpenLibrary search for books
  const booksUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=${bookLimit}`;
        searchTasks.push(fetch(booksUrl, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(r))));

        // Local API resources
        const base = API;
        const localUrl = `${base.replace(/\/$/, "")}/api/resources?query=${encodeURIComponent(q)}`;
        searchTasks.push(fetch(localUrl, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(r))).catch(() => ({ resources: [] })));

        const [ytResp, wikiResp, booksResp, localResp] = await Promise.all(searchTasks);

        // Process YouTube
        const ytItems = (ytResp && ytResp.items) || [];
        const mappedYt = ytItems.map((it) => ({
          id: it.id.videoId || (it.id && it.id.videoId) || Math.random().toString(36).slice(2, 9),
          title: it.snippet?.title || "Untitled",
          channel: it.snippet?.channelTitle || "",
          thumbnail: it.snippet?.thumbnails?.medium?.url || it.snippet?.thumbnails?.default?.url || "",
        }));

        // Process Wiki
        const wikiItems = (wikiResp?.query?.search || []).slice(0, 6).map((s) => ({
          id: s.pageid,
          title: s.title,
          snippet: s.snippet.replace(/<\/?span[^>]*>/g, ""),
          url: `https://en.wikipedia.org/?curid=${s.pageid}`,
        }));

        // Process books
        const bookDocs = (booksResp?.docs || []).slice(0, 6).map((b) => ({
          id: b.key,
          title: b.title,
          author: (b.author_name && b.author_name.join(", ")) || "",
          year: b.first_publish_year || "",
          cover: b.cover_i ? `https://covers.openlibrary.org/b/id/${b.cover_i}-M.jpg` : null,
        }));

        // Local resources
        const local = (localResp?.resources || localResp) || [];

        setYtResults(mappedYt);
        setWikiResults(wikiItems);
        setBookResults(bookDocs);
        setLocalResources(Array.isArray(local) ? local : []);
        // keep curated list available
        // openSourceList is static, no need to set state
      } catch (err) {
        if (err.name === "AbortError") return; // user typed again
        console.error(err);
        setError(err.message || "Search failed");
      } finally {
        setLoading(false);
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

  const onSubmit = (e) => {
    e.preventDefault();
    // Manual submit triggers immediate search
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
    <div className="min-h-screen bg-gray-50 py-8">
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
                  {loading && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {[...Array(4)].map((_, i) => (
                        <div key={i} className="flex gap-3 p-3 border rounded animate-pulse">
                          <div className="w-28 h-20 bg-gray-200 rounded" />
                          <div className="flex-1 space-y-2 py-1">
                            <div className="h-4 bg-gray-200 rounded w-3/4" />
                            <div className="h-3 bg-gray-200 rounded w-1/2" />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {!loading && error && <div className="text-sm text-red-600">{error}</div>}

                  {!loading && !YT_KEY && (
                    <div className="text-sm" style={{ color: ACCENT }}>Set <code>VITE_YT_API_KEY</code> in <code>client/.env</code> to enable YouTube search.</div>
                  )}

                  {!loading && YT_KEY && ytResults.length === 0 && (
                    <div className="text-sm text-gray-500">No videos found — try a different query.</div>
                  )}

                  {!loading && ytResults.length > 0 && (
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

                  {!loading && ytResults.length > 0 && YT_KEY && (
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