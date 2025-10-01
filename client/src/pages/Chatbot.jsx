import { useState, useRef, useEffect } from "react";
import { API } from "../hooks/helper";
import { ArrowLeft, ArrowRight, Trash2, Loader, Clock, Plus } from "lucide-react";

// Shared UI classes for consistency
const btnBase = "px-3 py-2 rounded-md text-sm font-medium";
const btnPrimary = `${btnBase} bg-[#FF8C42] text-white hover:bg-[#e6732f] shadow-sm`;
const btnNeutral = `${btnBase} bg-white/70 text-[#263238] hover:bg-white border border-gray-200`;
const btnGhost = "text-xs text-[#FF8C42]";

// Format session name: Chat DD/MM/YY/HH/MM/SS
function formatSessionName(s) {
  const ts =
    s?.createdAt || s?.created_at || s?.created || s?.createdAtServer || null;
  const d = ts ? new Date(ts) : null;
  const pad = (n) => String(n).padStart(2, "0");
  if (!d || isNaN(d.getTime())) {
    // fallback: use current time
    const now = new Date();
    return `Chat ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${String(
      now.getFullYear()
    ).slice(-2)}/${pad(now.getHours())}/${pad(now.getMinutes())}/${pad(
      now.getSeconds()
    )}`;
  }
  return `Chat ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${String(
    d.getFullYear()
  ).slice(-2)}/${pad(d.getHours())}/${pad(d.getMinutes())}/${pad(
    d.getSeconds()
  )}`;
}

// Safely format message text: escape HTML, convert URLs to links,
// support simple markdown (**bold**, *italic*, `code`) and preserve newlines.
function formatMessageText(text) {
  const t = String(text || "");
  const normalized = t.replace(/\r?\\n/g, "\n");

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, function (c) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      }[c];
    });
  }

  let out = escapeHtml(normalized);

  // linkify URLs (http/https) — use accent color for links
  out = out.replace(
    /(https?:\/\/[^\s]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" class="text-[#FF8C42] underline">$1</a>'
  );

  // inline code `code`
  out = out.replace(
    /`([^`]+)`/g,
    '<code class="bg-gray-100 px-1 rounded">$1</code>'
  );

  // bold **bold**
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // italic *italic* (avoid matching bold syntax)
  out = out.replace(/(^|[^*])\*([^*][^*]*?)\*([^*]|$)/g, function (_, a, b, c) {
    return a + "<em>" + b + "</em>" + c;
  });

  out = out.replace(/\n([ \t]+)/g, function (_, ws) {
    let rep = "";
    for (let i = 0; i < ws.length; i++) {
      if (ws[i] === "\t") {
        rep += "&nbsp;&nbsp;&nbsp;&nbsp;";
      } else {
        rep += "&nbsp;";
      }
    }
    return "<br/>" + rep;
  });
  out = out.replace(/\n/g, "<br/>");

  return out;
}

export default function Chatbot({ user }) {
  // if a user is provided (from App.jsx), scope sessions to their email
  const email = user?.email ? String(user.email).toLowerCase() : null;
  const sessionsQuery = email ? `?email=${encodeURIComponent(email)}` : "";
  const [messages, setMessages] = useState([]);
  const messagesRef = useRef([]);
  // track client-created messages that may not yet be present on the server
  const pendingClientIds = useRef(new Set());
  const [isTyping, setIsTyping] = useState(false);
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [viewHistory, setViewHistory] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const containerRef = useRef(null);
  // track whether we're actively creating a session to avoid racing the fetch that
  // loads messages for the newly-created session (which can briefly return empty)
  const creatingSessionRef = useRef(false);
  const justCreatedSessionRef = useRef(null);

  // A non-persistent initial welcome message shown when there's no session
  // or when the selected session has no stored messages. When a new session is
  // created we persist the opener; otherwise this object is only UI-only.
  const initialOpener = {
    from: "bot",
    text: "Hi — I'm a supportive assistant. How can I help today?",
    timestamp: new Date().toISOString(),
    clientId: "opener_local",
  };

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    // keep a ref of latest messages for use inside async callbacks
    messagesRef.current = messages;
  }, [messages]);

  // Load recent sessions on mount and when the signed-in user (email) changes
  useEffect(() => {
    // clear any active session when user changes
    // When the signed-in user changes we attempt to preserve the current
    // activeSession if it still appears in the refreshed session list. If not,
    // pick the most recent session as active.
    const prevActive = activeSession;
    setActiveSession(null);
    fetch(`${API}/api/chat/session${sessionsQuery}`)
      .then((r) => r.json())
      .then((data) => {
        const sess = data.sessions || [];
        setSessions(sess);
        // If we had an active session and it still exists, restore it.
        const stillThere = sess.find((s) => s.id === prevActive);
        if (stillThere) {
          setActiveSession(prevActive);
        } else if (sess.length > 0) {
          setActiveSession(sess[0].id);
        }
      })
      .catch(() => setSessions([]))
      .finally(() => {
        try {
          window.dispatchEvent(new CustomEvent("mindsphere:pageReady"));
        } catch (e) {}
      });
  }, [email]);

  // Load messages for active session
  useEffect(() => {
    if (!activeSession) {
      // No active session: show the non-persistent opener so the chat area is not empty.
      // This opener is UI-only unless the user creates a session (createSession will
      // persist it). Keeping the opener here prevents the chat area from appearing
      // blank and satisfies the request that the initial welcome message remain visible.
      setMessages([initialOpener]);
      return;
    }
    // When switching sessions we normally clear the current messages immediately
    // so that messages from the previous session disappear. However, if we just
    // created this session we may already have an opener + pending messages in
    // the UI; avoid clobbering them while the server finalizes persistence.
    const isJustCreated =
      creatingSessionRef.current &&
      justCreatedSessionRef.current === activeSession;
    if (!isJustCreated) {
      setMessages([]);
    }

    // build URL with sessionsQuery (which may already include ?email=...)
    // Fetch messages directly by session id (no tail parameter). The server will
    // return messages for that session. Clients can optionally include limit/offset
    // query params when implementing pagination.
    const url = `${API}/api/chat/session/${activeSession}/messages${
      sessionsQuery || ""
    }`;

    fetch(url)
      .then((r) => r.json())
      .then((data) => {
        const serverMsgs = Array.isArray(data.messages)
          ? data.messages.map((m) => ({ ...m }))
          : [];
        // If this session was just created and we're still persisting initial
        // opener/session-start messages, prefer to keep the existing UI messages
        // until the server returns concrete messages. Only replace when server
        // returns non-empty messages.
        if (isJustCreated) {
          if (serverMsgs.length > 0) {
            setMessages(serverMsgs);
            const serverClientIds = new Set(
              serverMsgs.map((m) => m.clientId).filter(Boolean)
            );
            const keep = new Set(
              [...pendingClientIds.current].filter((id) =>
                serverClientIds.has(id)
              )
            );
            pendingClientIds.current.clear();
            for (const id of keep) pendingClientIds.current.add(id);
          }
          // otherwise leave the current UI messages intact
        } else {
          if (serverMsgs.length === 0) {
            // If the selected session has no stored messages, show the UI-only opener.
            setMessages([initialOpener]);
          } else {
            // Replace local messages with only the server-provided messages for this session.
            setMessages(serverMsgs);

            // Keep only pending clientIds that were acknowledged by this session (if any).
            const serverClientIds = new Set(
              serverMsgs.map((m) => m.clientId).filter(Boolean)
            );
            const keep = new Set(
              [...pendingClientIds.current].filter((id) =>
                serverClientIds.has(id)
              )
            );
            pendingClientIds.current.clear();
            for (const id of keep) pendingClientIds.current.add(id);
          }
        }
      })
      .catch(() => {
        // on error, leave message list empty (do not resurrect previous session messages)
        setMessages([]);
      });
  }, [activeSession]);

  function createSession() {
    // Return a Promise that resolves with the created session id (or null)
    const body = email ? { user_email: email } : {};
    creatingSessionRef.current = true;
    return fetch(`${API}/api/chat/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.session_id) {
          setSessions((s) => [
            {
              id: data.session_id,
              createdAt: new Date().toISOString(),
              messageCount: 0,
            },
            ...s,
          ]);
          // mark just-created so the activeSession effect won't clobber UI messages
          justCreatedSessionRef.current = data.session_id;
          setActiveSession(data.session_id);
          // Use a hardcoded opener for the first message (do not call server /api/chat/init)
          const opener =
            "Hi — I'm a supportive assistant. How can I help today?";
          const bot = {
            from: "bot",
            text: opener,
            timestamp: new Date().toISOString(),
          };
          // give opener a clientId so it won't get lost when server data loads
          bot.clientId = `c_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
          pendingClientIds.current.add(bot.clientId);

          // Add a small 'session started' system string to mark session boundary
          const sessionStart = {
            from: "system",
            text: `Session started ${new Date().toLocaleString()}`,
            timestamp: new Date().toISOString(),
          };
          sessionStart.clientId = `c_${Date.now()}_${Math.floor(
            Math.random() * 10000
          )}`;
          pendingClientIds.current.add(sessionStart.clientId);

          // show opener + session-start marker in UI immediately
          setMessages([bot, sessionStart]);

          // persist opener and session-start (best-effort) and include user_email when available
          const persistBodyBot = email
            ? { message: bot, user_email: email }
            : { message: bot };
          const persistBodyStart = email
            ? { message: sessionStart, user_email: email }
            : { message: sessionStart };
          fetch(`${API}/api/chat/session/${data.session_id}/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(persistBodyBot),
          })
            .catch(() => {})
            .finally(() => {
              // persist the session-start marker after a tiny delay to keep order stable server-side
              setTimeout(() => {
                fetch(`${API}/api/chat/session/${data.session_id}/messages`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(persistBodyStart),
                })
                  .catch(() => {})
                  .finally(() => {
                    // session persistence steps finished
                    creatingSessionRef.current = false;
                    justCreatedSessionRef.current = null;
                  });
              }, 120);
            });
          return data.session_id;
        }
        return null;
      })
      .catch(() => null);
  }

  // Delete a session and switch to the next available session automatically.
  async function handleDeleteSession(id) {
    if (!id) return;
    try {
      const r = await fetch(`${API}/api/chat/session/${id}`, {
        method: "DELETE",
      });
      if (!r.ok) {
        // still remove locally to keep UI responsive
        setSessions((s) => s.filter((x) => x.id !== id));
        if (activeSession === id) {
          setActiveSession((prev) => {
            const remaining = sessions.filter((x) => x.id !== id);
            return remaining.length ? remaining[0].id : null;
          });
        }
        return;
      }

      // Refresh sessions from server to get canonical ordering
      const rr = await fetch(`${API}/api/chat/session${sessionsQuery}`);
      const dd = await rr.json();
      const sess = dd.sessions || [];
      setSessions(sess);

      if (activeSession === id) {
        // If the deleted session was active, switch to the next available session
        if (sess.length > 0) {
          setActiveSession(sess[0].id);
        } else {
          setActiveSession(null);
        }
      }
    } catch (e) {
      // best-effort local removal
      setSessions((s) => s.filter((x) => x.id !== id));
      if (activeSession === id) {
        const remaining = sessions.filter((x) => x.id !== id);
        setActiveSession(remaining.length ? remaining[0].id : null);
      }
    }
  }

  function navigateSession(dir) {
    // dir: 'prev' -> older, 'next' -> newer
    if (!sessions || sessions.length === 0 || !activeSession) return;
    const idx = sessions.findIndex((s) => s.id === activeSession);
    if (idx === -1) return;
    let newIdx = idx;
    if (dir === "prev") newIdx = Math.min(sessions.length - 1, idx + 1);
    if (dir === "next") newIdx = Math.max(0, idx - 1);
    if (newIdx !== idx) {
      const s = sessions[newIdx];
      if (s) setActiveSession(s.id);
    }
  }

  async function persistMessageAndSend(userText) {
    // Ensure a session exists; create one if needed
    let sessionId = activeSession;
    if (!sessionId) {
      // If there are existing sessions but no activeSession (edge case), use the newest one.
      if (sessions && sessions.length > 0) {
        sessionId = sessions[0].id;
        setActiveSession(sessionId);
      } else {
        // No sessions exist: create a fresh session now
        sessionId = await createSession();
        if (!sessionId) {
          // If session creation failed, proceed without persistence but still send to model
          sessionId = null;
        }
      }
    }

    const clientId = `c_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
    const userMsg = {
      from: "user",
      text: userText,
      timestamp: new Date().toISOString(),
      clientId,
    };
    pendingClientIds.current.add(clientId);
    setMessages((m) => [...m, userMsg]);

    // persist user message if we have a session id (include user_email when available)
    if (sessionId) {
      const persistBody = email
        ? { message: userMsg, user_email: email }
        : { message: userMsg };
      fetch(`${API}/api/chat/session/${sessionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(persistBody),
      }).catch(() => {});
    }

    // send to model endpoint
    setIsTyping(true);
    try {
      // Assemble context: last 10 messages including the new user message
      const combined = [...(messagesRef.current || []), userMsg];
      const last10 = combined
        .slice(-10)
        .map((m) => ({ from: m.from, text: m.text, timestamp: m.timestamp }));

      const payload = { message: userText, context: last10 };
      if (sessionId) payload.session_id = sessionId;

      const r = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      // Log the server-side intent detection result so developers can inspect safety/danger flags
      try {
        if (data && data.detected) {
          console.log("[Chatbot] server intent detection:", data.detected);
        }
      } catch (e) {}
      const replyText = data.response || "(No response)";
      const bot = {
        from: "bot",
        text: replyText,
        timestamp: new Date().toISOString(),
        clientId: `c_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      };
      // bot replies are local until persisted; add to pending set
      pendingClientIds.current.add(bot.clientId);
      setMessages((m) => [...m, bot]);

      // persist bot reply to session store as well (include user_email when available)
      if (sessionId) {
        const persistBody = email
          ? { message: bot, user_email: email }
          : { message: bot };
        fetch(`${API}/api/chat/session/${sessionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(persistBody),
        }).catch(() => {});
      }
    } catch (err) {
      const errMsg = {
        from: "bot",
        text: "(Error contacting server)",
        timestamp: new Date().toISOString(),
        clientId: `c_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      };
      pendingClientIds.current.add(errMsg.clientId);
      setMessages((m) => [...m, errMsg]);
    } finally {
      setIsTyping(false);
    }
  }

  function send() {
    if (!input.trim()) return;
    const text = input.trim();
    setInput("");
    persistMessageAndSend(text);
  }

  function openSession(sessionId) {
    setActiveSession(sessionId);
    setShowModal(false);
    // messages will load via effect
  }

  // handle Enter to send (Shift+Enter for newline)
  function onKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 p-13">
      <div className="relative rounded-2xl shadow-xl overflow-hidden bg-white/70 backdrop-blur-sm border border-gray-200">
        <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl md:text-3xl font-semibold text-[#263238]">
              Support Chat
            </h2>
            <p className="text-sm text-[#90A4AE] mt-1">
              Supportive strategies only — not a crisis or medical service. Chat
              history is saved per session.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className={`${btnNeutral} flex items-center gap-1 justify-center`}
              onClick={() => {
                setShowModal(true);
                fetch(`${API}/api/chat/session${sessionsQuery}`)
                  .then((r) => r.json())
                  .then((d) => setSessions(d.sessions || []))
                  .catch(() => {});
              }}
            >
              {/* history icon - lucide react */}
              <span>
                <Clock size={16} />
              </span>
              <span>History</span>
            </button>

            <button
              className={`${btnNeutral} flex items-center gap-1 justify-center`}
              onClick={createSession}
              title="Create new session"
            >
              {/* plus icon - lucide react  */}
              <span>
                <Plus size={16} />
              </span>
              <span>New</span>
            </button>
          </div>
        </div>

        <div className="md:flex">
          <div className="flex-1 p-4 sm:p-6">
            <div
              ref={containerRef}
              className="h-[60vh] md:h-[56vh] overflow-y-auto space-y-4 bg-transparent p-4 rounded-lg"
            >
              {messages
                .filter((m) => m.from !== "system")
                .map((m, i) => (
                  <div
                    key={i}
                    className={`flex items-start gap-3 ${
                      m.from === "user" ? "justify-end" : "justify-start"
                    }`}
                  >
                    {m.from === "bot" && (
                      <div className="flex-shrink-0">
                        <div className="w-9 h-9 bg-[#FF8C42]/10 text-[#FF8C42] rounded-full flex items-center justify-center font-semibold">
                          <img
                            src="/mindsphere-logo.png"
                            alt="Logo"
                            className="w-7 h-7"
                          />
                        </div>
                      </div>
                    )}

                    <div
                      className={`max-w-[78%] px-4 py-2 rounded-xl shadow-sm ${
                        m.from === "user"
                          ? "bg-[#FF8C42] text-white rounded-br-none"
                          : "bg-white text-[#263238] rounded-bl-none border border-gray-200"
                      }`}
                    >
                      <div
                        className="whitespace-pre-wrap leading-relaxed"
                        dangerouslySetInnerHTML={{
                          __html: formatMessageText(m.text),
                        }}
                      />
                    </div>

                    {m.from === "user" && (
                      <div className="flex-shrink-0">
                        <div className="w-9 h-9 bg-[#FF8C42]/10 text-[#FF8C42] rounded-full flex items-center justify-center font-semibold">
                          <img src="/user.png" alt="Logo" className="w-7 h-7" />
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              {isTyping && (
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-9 h-9 bg-[#FF8C42]/10 text-[#FF8C42] rounded-full flex items-center justify-center font-semibold">
                      <img
                        src="/mindsphere-logo.png"
                        alt="AI"
                        className="w-7 h-7"
                      />
                    </div>
                  </div>
                  <div className="max-w-[78%] px-4 py-2 rounded-xl bg-white text-gray-500 rounded-bl-none border border-gray-200 italic">
                    Generating...
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4">
              <textarea
                className="w-full border border-gray-200 rounded-lg p-3 min-h-[56px] resize-none focus:ring-2 focus:ring-[#FF8C42]/30 shadow-sm"
                placeholder="Type a message (Shift+Enter for newline)..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
              />

              <div className="flex items-center justify-between m-1">
                <div className="text-xs text-[#90A4AE] m-2">
                  You can type anytime — a session will be created when you send
                  your first message.
                </div>
                <div className="flex items-center gap-2">
                  <button className={btnNeutral} onClick={() => setInput("")}>
                    Clear
                  </button>
                  <button className={btnPrimary} onClick={send}>
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar (Sessions & tips) intentionally removed per user preference */}
        </div>
      </div>
      {showModal && (
        <ChatbotModal
          sessions={sessions}
          activeSession={activeSession}
          onClose={() => setShowModal(false)}
          onCreate={createSession}
          onOpen={(id) => openSession(id)}
          onDelete={(id) => handleDeleteSession(id)}
        />
      )}
    </div>
  );
}

// Note: Modal markup is rendered at the end of the component; since this file is JSX and returns above,
// we instead inject the modal via a portal-like conditional rendering above. To keep edits minimal,
// we add a small helper component-like fragment that will be mounted by React when showModal is true.
export function ChatbotModal({
  sessions,
  activeSession,
  onClose,
  onOpen,
  onDelete,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* clickable dimmed backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative w-full mx-4 sm:mx-auto max-w-lg bg-white border border-gray-200 rounded-xl shadow-2xl p-4 sm:p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-[#263238]">Session history</h3>
          <div className="flex items-center gap-2">
            <button
              className={`${btnNeutral} flex items-center gap-1 px-2 py-1 text-sm`}
              onClick={async () => {
                if (typeof onCreate === "function") {
                  const sid = await onCreate();
                  if (sid && typeof onOpen === 'function') onOpen(sid);
                }
                if (typeof onClose === 'function') onClose();
              }}
            >
              <span>New</span>
            </button>
            <button
              className={`${btnNeutral} px-2 py-1 text-sm`}
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>

        <div className="space-y-2 max-h-[68vh] overflow-auto">
          {sessions.length === 0 && (
            <div className="text-sm text-[#263238]">No sessions found</div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              className={`flex items-center justify-between border p-3 rounded ${
                s.id === activeSession
                  ? "bg-[#FFFAF4] border-[#FF8C42]"
                  : "border-gray-200 bg-white/80"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#263238] truncate">
                  <span className="font-mono">{`Chat_${s.id}`}</span>
                </div>
                <div className="text-xs text-[#90A4AE] truncate">
                  {s.lastMessage
                    ? s.lastMessage.text || "Message"
                    : "Empty session"}
                </div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button
                  className={`${btnGhost} px-2`}
                  onClick={() => onOpen(s.id)}
                >
                  {s.id === activeSession ? "Active" : "Open"}
                </button>
                <button
                  className="text-xs text-red-500 px-2"
                  onClick={() => onDelete(s.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
