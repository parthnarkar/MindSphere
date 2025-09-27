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
  { id: 1, title: "Intro to coping skills", type: "video", language: "English", url: "" },
  { id: 2, title: "How to support a friend", type: "video", language: "Hindi", url: "" },
  { id: 3, title: "Offline resource map", type: "guide", language: "Regional", url: "" },
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

  // Loading & error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const controllerRef = useRef(null);

  // Use Vite env vars for YouTube API, allow overriding via variables
  const YT_KEY = import.meta.env.VITE_YT_API_KEY || null;

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
          const ytUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=9&q=${encodeURIComponent(
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
        const booksUrl = `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=6`;
        searchTasks.push(fetch(booksUrl, { signal }).then((r) => (r.ok ? r.json() : Promise.reject(r))));

        // Local API resources
        const base = API || "http://localhost:5000";
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
      } catch (err) {
        if (err.name === "AbortError") return; // user typed again
        console.error(err);
        setError(err.message || "Search failed");
      } finally {
        setLoading(false);
      }
    }, 450),
    [YT_KEY]
  );

  // Trigger search when query changes
  useEffect(() => {
    doSearch(query);
  }, [query, doSearch]);

  const onSubmit = (e) => {
    e.preventDefault();
    // Manual submit triggers immediate search
    doSearch(query);
  };

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
          <div className="p-6 sm:p-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold text-gray-900">Resource Finder</h1>
                <p className="mt-1 text-sm text-gray-500">Search videos, articles, books and local support resources.</p>
              </div>

                <form onSubmit={onSubmit} className="w-full sm:w-1/2">
                <label htmlFor="resource-search" className="sr-only">Search resources</label>
                <div className="relative">
                  <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
                  </span>
                  <input
                    id="resource-search"
                    className="w-full pl-10 pr-28 py-2 border rounded-lg shadow-sm focus:ring-2 focus:ring-blue-400 focus:outline-none"
                    placeholder="e.g. coping with anxiety"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    aria-label="Search resources"
                  />
                  <div className="absolute inset-y-0 right-0 flex items-center gap-2 pr-2">
                    {query && (
                      <button type="button" onClick={() => setQuery("")} className="text-sm px-2 py-1 rounded-md text-gray-600 hover:bg-gray-100">Clear</button>
                    )}
                    <button type="submit" className="bg-blue-600 text-white px-4 py-1.5 rounded-md hover:bg-blue-700">Search</button>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => setQuery(s)}
                      className="text-xs md:text-sm px-3 py-1 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-700"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </form>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 p-6 sm:p-8 bg-gray-50">
            <main className="lg:col-span-2 space-y-6">
              <section>
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-lg font-semibold text-gray-800">YouTube Videos</h2>
                  <div className="text-sm text-gray-500">{!YT_KEY ? <span className="text-yellow-600">YouTube API key not set</span> : `${ytResults.length} results`}</div>
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
                    <div className="text-sm text-gray-600">Set <code>VITE_YT_API_KEY</code> in <code>client/.env</code> to enable YouTube search.</div>
                  )}

                  {!loading && YT_KEY && ytResults.length === 0 && (
                    <div className="text-sm text-gray-500">No videos found — try a different query.</div>
                  )}

                  {!loading && ytResults.length > 0 && (
                    <div className="grid gap-4 md:grid-cols-2">
                      {ytResults.map((v) => (
                        <a key={v.id} href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="flex gap-3 p-3 rounded-lg border hover:shadow-md hover:bg-white transition bg-white">
                          <div className="relative w-24 sm:w-28 h-16 sm:h-20 flex-shrink-0">
                            {v.thumbnail ? (
                              <img src={v.thumbnail} alt="thumb" className="w-full h-full object-cover rounded" />
                            ) : (
                              <div className="w-full h-full bg-gray-100 rounded" />
                            )}
                            <div className="absolute inset-0 flex items-center justify-center">
                              <div className="bg-black bg-opacity-30 rounded-full p-2">
                                <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                              </div>
                            </div>
                          </div>
                          <div className="flex-1">
                            <div className="font-medium text-gray-900 line-clamp-2">{v.title}</div>
                            <div className="text-xs text-gray-500 mt-1">{v.channel}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-gray-800 mb-3">Wikipedia Articles</h2>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  {wikiResults.length === 0 ? (
                    <div className="text-sm text-gray-500">No articles found.</div>
                  ) : (
                    <ul className="space-y-3">
                      {wikiResults.map((w) => (
                        <li key={w.id} className="p-3 rounded border hover:bg-gray-50">
                          <a href={w.url} target="_blank" rel="noreferrer" className="font-medium text-blue-600 hover:underline">
                            {w.title}
                          </a>
                          <div className="text-sm text-gray-700 mt-1" dangerouslySetInnerHTML={{ __html: w.snippet }} />
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>

              <section>
                <h2 className="text-lg font-semibold text-gray-800 mb-3">Books (OpenLibrary)</h2>
                <div className="bg-white p-4 rounded-lg shadow-sm">
                  {bookResults.length === 0 ? (
                    <div className="text-sm text-gray-500">No books found.</div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2">
                      {bookResults.map((b) => (
                        <div key={b.id} className="flex gap-3 items-start border p-3 rounded hover:shadow-sm bg-white">
                          {b.cover ? (
                            <img src={b.cover} className="w-20 h-28 object-cover rounded" alt={b.title} />
                          ) : (
                            <div className="w-20 h-28 bg-gray-100 rounded flex items-center justify-center text-xs text-gray-500">No cover</div>
                          )}
                          <div>
                            <div className="font-medium text-gray-900">{b.title}</div>
                            <div className="text-sm text-gray-600">{b.author}</div>
                            <div className="text-xs text-gray-500">{b.year}</div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </main>

            <aside className="space-y-6">
              <div className="bg-white p-4 rounded-lg shadow-sm">
                <h3 className="font-semibold mb-3">Local Resources</h3>
                {localResources.length === 0 ? (
                  <div className="text-sm text-gray-500">No local resources found for this query. Showing fallbacks.</div>
                ) : (
                  <ul className="space-y-3">
                    {localResources.map((r) => (
                      <li key={r.id} className="text-sm border p-3 rounded hover:bg-gray-50">
                        <div className="font-medium text-gray-900">{r.title}</div>
                        <div className="text-xs text-gray-600">{r.type} — {r.language}</div>
                        {r.url && (
                          <a href={r.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline mt-1 block">Open</a>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {localResources.length === 0 && (
                  <div className="mt-3 space-y-2">
                    {FALLBACK.map((f) => (
                      <div key={f.id} className="border p-3 rounded bg-gray-50">
                        <div className="font-medium">{f.title}</div>
                        <div className="text-xs text-gray-600">{f.type}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-white p-4 rounded-lg shadow-sm">
                <h3 className="font-semibold mb-3">Crisis & Helplines</h3>
                <ul className="text-sm space-y-2">
                  <li>
                    <div className="font-medium">Crisis Text Line</div>
                    <div className="text-xs text-gray-600">Text HOME to 741741</div>
                  </li>
                  <li>
                    <div className="font-medium">National Suicide Prevention Lifeline</div>
                    <div className="text-xs text-gray-600">988</div>
                  </li>
                  <li>
                    <div className="font-medium">Campus Counseling</div>
                    <div className="text-xs text-gray-600">(555) 123-4567</div>
                  </li>
                </ul>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
}