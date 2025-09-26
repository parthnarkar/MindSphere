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
    <div>
      <div className="max-w-5xl mx-auto p-4">
        <h1 className="text-3xl font-bold text-center mb-4">Resource Finder</h1>

        <form onSubmit={onSubmit} className="flex items-center gap-2 mb-4">
          <input
            className="flex-1 border rounded px-4 py-2 shadow-sm"
            placeholder="Search videos, articles, books, e.g. 'coping with anxiety'"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search resources"
          />
          <button
            type="submit"
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
          >
            Search
          </button>
        </form>

        <div className="mb-4 flex flex-wrap gap-2 items-center">
          <div className="text-sm text-gray-500 mr-2">Try:</div>
          {suggestions.map((s) => (
            <button
              key={s}
              onClick={() => setQuery(s)}
              className="text-sm px-3 py-1 rounded bg-gray-100 hover:bg-gray-200"
            >
              {s}
            </button>
          ))}
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <section className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-semibold">YouTube Videos</h2>
                {!YT_KEY && <span className="text-sm text-yellow-600">YouTube API key not set</span>}
              </div>

              <div className="bg-white p-4 rounded shadow">
                {loading && <div className="text-sm text-gray-600">Searching...</div>}
                {error && <div className="text-sm text-red-600">{error}</div>}

                {!YT_KEY ? (
                  <div className="text-sm text-gray-600">Set <code>VITE_YT_API_KEY</code> in <code>client/.env</code> to enable YouTube search.</div>
                ) : ytResults.length === 0 && !loading ? (
                  <div className="text-sm text-gray-500">No videos found — try a different query.</div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {ytResults.map((v) => (
                      <div key={v.id} className="flex gap-3 p-2 rounded border">
                        {v.thumbnail ? (
                          <img src={v.thumbnail} alt="thumb" className="w-28 h-20 object-cover rounded" />
                        ) : (
                          <div className="w-28 h-20 bg-gray-100 rounded" />
                        )}
                        <div className="flex-1">
                          <div className="font-medium">{v.title}</div>
                          <div className="text-xs text-gray-600">{v.channel}</div>
                          <div className="mt-2">
                            <a
                              className="text-sm text-blue-600 hover:underline"
                              href={`https://www.youtube.com/watch?v=${v.id}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              Watch on YouTube
                            </a>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="mb-6">
              <h2 className="text-xl font-semibold mb-2">Wikipedia Articles</h2>
              <div className="bg-white p-4 rounded shadow">
                {wikiResults.length === 0 ? (
                  <div className="text-sm text-gray-500">No articles found.</div>
                ) : (
                  <ul className="space-y-3">
                    {wikiResults.map((w) => (
                      <li key={w.id} className="border p-3 rounded">
                        <a href={w.url} target="_blank" rel="noreferrer" className="font-medium text-blue-600">
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
              <h2 className="text-xl font-semibold mb-2">Books (OpenLibrary)</h2>
              <div className="bg-white p-4 rounded shadow">
                {bookResults.length === 0 ? (
                  <div className="text-sm text-gray-500">No books found.</div>
                ) : (
                  <div className="grid gap-3 md:grid-cols-2">
                    {bookResults.map((b) => (
                      <div key={b.id} className="flex gap-3 items-center border p-2 rounded">
                        {b.cover ? <img src={b.cover} className="w-20 h-28 object-cover rounded" alt={b.title} /> : <div className="w-20 h-28 bg-gray-100 rounded" />}
                        <div>
                          <div className="font-medium">{b.title}</div>
                          <div className="text-sm text-gray-600">{b.author}</div>
                          <div className="text-xs text-gray-500">{b.year}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>

          <aside className="space-y-6">
            <div className="bg-white p-4 rounded shadow">
              <h3 className="font-semibold mb-2">Local Resources</h3>
              {localResources.length === 0 ? (
                <div className="text-sm text-gray-500">No local resources found for this query. Showing fallbacks.</div>
              ) : (
                <ul className="space-y-2">
                  {localResources.map((r) => (
                    <li key={r.id} className="text-sm">
                      <div className="font-medium">{r.title}</div>
                      <div className="text-xs text-gray-600">{r.type} — {r.language}</div>
                    </li>
                  ))}
                </ul>
              )}

              {localResources.length === 0 && (
                <div className="mt-3">
                  {FALLBACK.map((f) => (
                    <div key={f.id} className="border p-2 rounded mb-2">
                      <div className="font-medium">{f.title}</div>
                      <div className="text-xs text-gray-600">{f.type}</div>
                    </div>
                  ))}
                </div>
              )}
            
            </div>

            <div className="bg-white p-4 rounded shadow">
              <h3 className="font-semibold mb-2">Crisis & Helplines</h3>
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
  );
}