import React, { useEffect, useState, useRef } from "react";
import { API } from "../hooks/helper";
import { auth } from "../services/firebase";

const ACCENT = "#263238";

function formatDate(ts) {
  try {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleString();
  } catch (e) {
    return "Unknown";
  }
}

// Return date-only (no time) in a locale-friendly format
function formatDateOnly(ts) {
  try {
    const d = ts ? new Date(ts) : new Date();
    return d.toLocaleDateString();
  } catch (e) {
    return "Unknown";
  }
}

const PeerToPeer = () => {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Form state
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // UI state for expanded posts
  const [expanded, setExpanded] = useState({});
  const [filterMode, setFilterMode] = useState("all"); // all | mine

  const base = API;
  // ref to hold a reusable fetchPosts function so other handlers can call it
  const fetchPostsRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const fetchPosts = async (emailQuery) => {
      const MIN_LOADING_MS = 2000; // ensure spinner shows at least this long
      const start = Date.now();
      setLoading(true);
      setError(null);
      try {
        const url = emailQuery ? `${base}/api/posts?email=${encodeURIComponent(emailQuery)}` : `${base}/api/posts`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // normalize to array
        const arr = Array.isArray(data) ? data : data.posts || [];
        if (mounted) {
          // Preserve server/database ordering. Do not re-sort here so the
          // server can control ordering (e.g., newest-first or custom).
          setPosts(arr);
        }
      } catch (e) {
        console.warn("Could not fetch posts", e);
        if (mounted) setError("Could not load posts");
      } finally {
        // ensure the loader is visible for a minimum duration to avoid
        // a jarring very-fast flash. Wait remaining time if needed.
        try {
          const elapsed = Date.now() - start;
          const wait = Math.max(0, MIN_LOADING_MS - elapsed);
          if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        } catch (e) {
          // ignore timer errors
        }
        if (mounted) setLoading(false);
      }
    };
    // expose fetchPosts to other handlers by attaching to component scope
    // (we'll call it after successful POST to resync with server)
    fetchPostsRef.current = fetchPosts;
    const initialEmail = (filterMode === 'mine' && auth?.currentUser?.email) ? auth.currentUser.email : null;
    fetchPosts(initialEmail);
    return () => (mounted = false);
  }, [base]);

  // When the filter changes, ask the server for the appropriate set
  useEffect(() => {
    if (!fetchPostsRef.current) return;
    if (filterMode === 'mine') {
      const userEmail = auth?.currentUser?.email;
      if (userEmail) fetchPostsRef.current(userEmail);
      else fetchPostsRef.current();
    } else {
      fetchPostsRef.current();
    }
  }, [filterMode]);

  const submitPost = async (e) => {
    e.preventDefault();
    if (!content.trim() && !title.trim()) return;
    setSubmitting(true);
    const user = auth?.currentUser;
    const author = user?.displayName || user?.email || "Anonymous";
    const payload = {
      title: title.trim() || "(Untitled)",
      content: content.trim(),
      author,
      email: user?.email || null,
      createdAt: new Date().toISOString(),
    };

    // optimistic update
    setPosts((p) => [{ ...payload, id: `local-${Date.now()}` }, ...p]);

    try {
      const res = await fetch(`${base}/api/posts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        // server may not support POST; warn and keep optimistic local post
        console.warn("Server rejected new post", res.status);
      } else {
        // Attempt to read server response and reconcile optimistic item with saved record
        try {
          const saved = await res.json().catch(() => null);
          if (saved && (saved.id || saved._id)) {
            const serverId = saved.id || saved._id;
            // replace the optimistic local entry with the authoritative server record
            setPosts((prev) =>
              prev.map((it) => {
                // match by local-id prefix or createdAt timestamp
                if (it.id && String(it.id).startsWith('local-') && it.createdAt === payload.createdAt) {
                  // ensure createdAt is a string
                  const out = Object.assign({}, saved);
                  if (out.createdAt && typeof out.createdAt !== 'string' && out.createdAt.toISOString) {
                    try {
                      out.createdAt = out.createdAt.toISOString();
                    } catch (e) {
                      /* ignore */
                    }
                  }
                  out.id = serverId;
                  return out;
                }
                return it;
              })
            );
          } else {
            // small delay then re-fetch to reconcile if server didn't return the saved body
            await new Promise((r) => setTimeout(r, 250));
            if (fetchPostsRef.current) await fetchPostsRef.current();
          }
        } catch (err) {
          console.warn('Could not refresh posts after save', err);
          try {
            await new Promise((r) => setTimeout(r, 250));
            if (fetchPostsRef.current) await fetchPostsRef.current();
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn("Failed to persist post", err);
    } finally {
      setSubmitting(false);
      setTitle("");
      setContent("");
    }
  };

  const deletePost = async (p) => {
    const confirmDelete = window.confirm('Delete this post? This cannot be undone.');
    if (!confirmDelete) return;

    // Optimistic UI remove
    setPosts((prev) =>
      prev.filter((pp) => {
        const pid = pp.id || `${pp.email}-${pp.createdAt}`;
        const target = p.id || `${p.email}-${p.createdAt}`;
        return String(pid) !== String(target);
      })
    );

    // Prepare payload: ensure createdAt is an ISO string when possible
    const idToSend = p.id || p._id || null;
    let createdAtToSend = null;
    try {
      if (typeof p.createdAt === 'string') createdAtToSend = p.createdAt;
      else if (p.createdAt && p.createdAt.toISOString) createdAtToSend = p.createdAt.toISOString();
      else createdAtToSend = null;
    } catch (e) {
      createdAtToSend = null;
    }

    const body = { id: idToSend, email: p.email || null, createdAt: createdAtToSend };

    try {
      const res = await fetch(`${base}/api/posts`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      // If server couldn't delete, re-fetch to reconcile (restores optimistic item)
      if (!res.ok) {
        console.warn('Delete request failed', res.status);
        if (fetchPostsRef.current) await fetchPostsRef.current();
        return;
      }

      // parse JSON body and check deleted flag when present
      let data = null;
      try {
        data = await res.json();
      } catch (e) {
        data = null;
      }
      if (data && data.deleted === false) {
        // not deleted on server — refresh posts to restore
        if (fetchPostsRef.current) await fetchPostsRef.current();
      }
    } catch (err) {
      console.warn('Failed to delete on server', err);
      // network or other error — re-fetch to restore optimistic item
      try {
        if (fetchPostsRef.current) await fetchPostsRef.current();
      } catch (_) {}
    }
  };

  const likePost = async (p) => {
    const userEmail = auth?.currentUser?.email;
    if (!userEmail) {
      window.alert('Please sign in to like posts');
      return;
    }

    const id = p.id || p._id || `${p.email}-${p.createdAt}`;
    const likedBy = Array.isArray(p.liked_by) ? p.liked_by : (Array.isArray(p.likedBy) ? p.likedBy : []);
    const currentLiked = likedBy.some((e) => String(e || '').toLowerCase() === String(userEmail || '').toLowerCase());
    const action = currentLiked ? 'unlike' : 'like';

    // Optimistic update
    setPosts((prev) =>
      prev.map((it) => {
        const pid = it.id || it._id || `${it.email}-${it.createdAt}`;
        if (String(pid) !== String(id)) return it;
        const next = { ...it };
        const lb = Array.isArray(next.liked_by) ? [...next.liked_by] : [];
        if (action === 'like') {
          if (!lb.some((e) => String(e || '').toLowerCase() === String(userEmail).toLowerCase())) lb.push(userEmail);
        } else {
          const target = String(userEmail).toLowerCase();
          for (let i = lb.length - 1; i >= 0; i--) if (String(lb[i] || '').toLowerCase() === target) lb.splice(i, 1);
        }
        next.liked_by = lb;
        next.likes_count = lb.length;
        return next;
      })
    );

    // Send request
    try {
      const res = await fetch(`${base}/api/posts/like`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, email: userEmail, action }),
      });
      if (!res.ok) {
        console.warn('Like request failed', res.status);
        if (fetchPostsRef.current) await fetchPostsRef.current();
        return;
      }
      const data = await res.json().catch(() => null);
      if (data && (data.likes_count != null)) {
        // reconcile with server
        setPosts((prev) => prev.map((it) => {
          const pid = it.id || it._id || `${it.email}-${it.createdAt}`;
          if (String(pid) !== String(id)) return it;
          const next = { ...it };
          next.likes_count = data.likes_count;
          // adjust liked_by conservatively: if server says liked, ensure user present
          try {
            if (data.liked) {
              const lb = Array.isArray(next.liked_by) ? [...next.liked_by] : [];
              if (!lb.some((e) => String(e || '').toLowerCase() === String(userEmail).toLowerCase())) lb.push(userEmail);
              next.liked_by = lb;
            } else {
              next.liked_by = (Array.isArray(next.liked_by) ? next.liked_by.filter((e)=> String(e||'').toLowerCase() !== String(userEmail).toLowerCase()) : []);
            }
          } catch (e) {
            /* ignore */
          }
          return next;
        }));
      } else {
        // unknown response shape — re-fetch to be safe
        if (fetchPostsRef.current) await fetchPostsRef.current();
      }
    } catch (err) {
      console.warn('Failed to send like', err);
      try { if (fetchPostsRef.current) await fetchPostsRef.current(); } catch (_) {}
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-24">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-2">
          <h1 className="text-2xl font-extrabold" style={{ color: ACCENT }}>
            Peer-to-Peer Forum
          </h1>
        </div>
        <p className="text-sm text-gray-600 mb-6">
          A supportive place where students can share short posts and resources.
          Be kind and do not post personal identifiable information.
        </p>

        <form
          onSubmit={submitPost}
          className="bg-white p-4 rounded-lg shadow mb-6"
        >
          <div className="mb-3">
            <label className="text-xs text-gray-500">Title (optional)</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full border rounded px-3 py-2 mt-1"
              placeholder="Short title"
            />
          </div>
          <div className="mb-3">
            <label className="text-xs text-gray-500">Post</label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={4}
              className="w-full border rounded px-3 py-2 mt-1"
              placeholder="Share something helpful or ask for support..."
            />
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="submit"
              disabled={submitting || (!content.trim() && !title.trim())}
              className={`px-4 py-2 rounded text-white ${
                submitting ? "bg-indigo-300" : "bg-indigo-600"
              }`}
            >
              {submitting ? "Posting..." : "Post"}
            </button>
          </div>
        </form>

        <section className="bg-gray-50 rounded-lg p-4 shadow-sm">
          <div className="flex items-center justify-between gap-4 mb-4">
            <h2 className="text-lg font-semibold">Public Posts</h2>
            <div className="flex items-center gap-2">
              <div className="inline-flex items-center bg-white rounded-full p-1 border">
                <button
                  type="button"
                  onClick={() => setFilterMode("all")}
                  className={`text-sm px-3 py-1 rounded-full ${
                    filterMode === "all"
                      ? "bg-blue-600 text-white"
                      : "bg-transparent text-gray-700"
                  }`}
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setFilterMode("mine")}
                  className={`text-sm px-3 py-1 rounded-full ${
                    filterMode === "mine"
                      ? "bg-blue-600 text-white"
                      : "bg-transparent text-gray-700"
                  }`}
                >
                  My posts
                </button>
              </div>
            </div>
          </div>

          {/* Loading / error / empty states */}
          {loading ? (
            <div className="flex items-center gap-3 py-2 text-sm text-gray-600">
              <div className="w-5 h-5 border-2 border-gray-200 rounded-full animate-spin" style={{ borderTopColor: ACCENT }} aria-hidden="true" />
              <div>Loading posts...</div>
            </div>
          ) : error ? (
            <div className="text-sm text-red-500 mb-3">{error}</div>
          ) : posts.length === 0 ? (
            <div className="text-sm text-gray-500">No posts yet — be the first to share.</div>
          ) : (
            <div className="space-y-4 max-h-[60vh] md:max-h-[60vh] overflow-y-auto pr-2">
              {(filterMode === "all"
                ? posts
                : posts.filter((pp) => String(pp.email || "").toLowerCase() === String(auth?.currentUser?.email || "").toLowerCase())
              ).map((p) => {
                const id = p.id || p._id || `${p.email}-${p.createdAt}`;
                const isExpanded = !!expanded[id];
                const likedBy = Array.isArray(p.liked_by) ? p.liked_by : (Array.isArray(p.likedBy) ? p.likedBy : []);
                const likeCount = (p.likes_count != null) ? p.likes_count : (Array.isArray(likedBy) ? likedBy.length : 0);
                const userEmail = auth?.currentUser?.email || '';
                const liked = userEmail ? likedBy.some((e) => String(e || '').toLowerCase() === String(userEmail).toLowerCase()) : false;
                const titleText = typeof p.title === "string" ? p.title : (p.title && (p.title.title || p.title.name)) || "(Untitled)";
                const authorDisplay = typeof p.author === "string" ? p.author : (p.author && (p.author.name || p.author.email || p.author.role)) || p.email || "Anonymous";
                const isOwner = String(p.email || "").toLowerCase() === String(auth?.currentUser?.email || "").toLowerCase();
                const contentText = typeof p.content === "string" ? p.content : (p.content && (p.content.text || String(p.content))) || "";

                return (
                  <article key={id} className="bg-white border rounded-lg p-4 shadow-sm">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3">
                          <div className="font-medium text-gray-800 truncate">{titleText}</div>
                          <div className="text-xs text-gray-500">by {authorDisplay}</div>
                        </div>
              <div className="text-xs text-gray-500 mt-1">{formatDateOnly(p.createdAt || p.timestamp || p.date)}</div>
                        <div className="mt-3 text-sm text-gray-700 whitespace-pre-wrap">{isExpanded ? contentText : (contentText && contentText.length > 280 ? contentText.slice(0, 280) + "..." : contentText)}</div>
                      </div>
                      <div className="flex items-start gap-2">
                        <button type="button" onClick={() => likePost(p)} className={`text-sm px-2 py-1 rounded ${liked ? 'bg-pink-100 text-pink-700' : 'bg-white border text-gray-700'}`}>
                          {liked ? '♥' : '♡'} {likeCount || 0}
                        </button>
                        {filterMode === 'mine' && isOwner && (
                          <button type="button" onClick={() => deletePost(p)} className="text-sm text-red-600 bg-red-50 border border-red-100 px-2 py-1 rounded">Delete</button>
                        )}
                      </div>
                    </div>
                    {contentText && contentText.length > 280 && (
                      <div className="mt-3 text-right">
                        <button className="text-sm text-blue-600" onClick={() => setExpanded((s) => ({ ...s, [id]: !s[id] }))}>{isExpanded ? "Show less" : "Read more"}</button>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default PeerToPeer;
