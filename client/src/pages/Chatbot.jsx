import { useState, useRef, useEffect } from "react";
import { API } from "../hooks/helper";

// Shared UI classes for consistency
const btnBase = 'px-3 py-2 rounded-md text-sm font-medium';
const btnPrimary = `${btnBase} bg-blue-600 text-white hover:bg-blue-700`;
const btnNeutral = `${btnBase} bg-gray-100 text-gray-800 hover:bg-gray-200`;
const btnGhost = 'text-xs text-blue-600';

// Format session name: Chat DD/MM/YY/HH/MM/SS
function formatSessionName(s) {
  const ts = s?.createdAt || s?.created_at || s?.created || s?.createdAtServer || null;
  const d = ts ? new Date(ts) : null;
  const pad = (n) => String(n).padStart(2, '0');
  if (!d || isNaN(d.getTime())) {
    // fallback: use current time
    const now = new Date();
    return `Chat ${pad(now.getDate())}/${pad(now.getMonth()+1)}/${String(now.getFullYear()).slice(-2)}/${pad(now.getHours())}/${pad(now.getMinutes())}/${pad(now.getSeconds())}`;
  }
  return `Chat ${pad(d.getDate())}/${pad(d.getMonth()+1)}/${String(d.getFullYear()).slice(-2)}/${pad(d.getHours())}/${pad(d.getMinutes())}/${pad(d.getSeconds())}`;
}

export default function Chatbot({ user }) {
  // if a user is provided (from App.jsx), scope sessions to their email
  const email = user?.email ? String(user.email).toLowerCase() : null;
  const sessionsQuery = email ? `?email=${encodeURIComponent(email)}` : '';
  const [messages, setMessages] = useState([
    // keep minimal initial welcome; the server can generate a more specific opener
    { from: "bot", text: "Hi — I'm a supportive assistant. How can I help today?" },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [viewHistory, setViewHistory] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const containerRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Load recent sessions on mount and when the signed-in user (email) changes
  useEffect(() => {
    // clear any active session when user changes
    setActiveSession(null);
    fetch(`${API}/api/chat/session${sessionsQuery}`)
      .then((r) => r.json())
      .then((data) => {
        const sess = data.sessions || [];
        setSessions(sess);
        if (sess.length > 0) setActiveSession(sess[0].id);
      })
      .catch(() => setSessions([]));
  }, [email]);

  // Load messages for active session
  useEffect(() => {
    if (!activeSession) {
      setMessages([
        { from: "bot", text: "Hi — I'm a supportive assistant. How can I help today?" },
      ]);
      return;
    }
    fetch(`${API}/api/chat/session/${activeSession}/messages${sessionsQuery}`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length) {
          setMessages(data.messages.map((m) => ({ ...m })));
        } else {
          // If server returned no messages, avoid overwriting local messages that may include
          // the user's first message (which could still be pending persistence). Only set
          // the default opener when there are no local messages.
          setMessages((prev) => (Array.isArray(prev) && prev.length > 0 ? prev : [
            { from: "bot", text: "Hi — I'm a supportive assistant. How can I help today?" },
          ]));
        }
      })
      .catch(() => {
        // ignore
      });
  }, [activeSession]);

  function createSession() {
    // Return a Promise that resolves with the created session id (or null)
    const body = email ? { user_email: email } : {};
    return fetch(`${API}/api/chat/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        if (data.session_id) {
          setSessions((s) => [{ id: data.session_id, createdAt: new Date().toISOString(), messageCount: 0 }, ...s]);
          setActiveSession(data.session_id);
          // Use a hardcoded opener for the first message (do not call server /api/chat/init)
          const opener = "Hi — I'm a supportive assistant. How can I help today?";
          const bot = { from: 'bot', text: opener, timestamp: new Date().toISOString() };
          setMessages([bot]);
          // persist opener (best-effort) and include user_email when available
          const persistBody = email ? { message: bot, user_email: email } : { message: bot };
          fetch(`${API}/api/chat/session/${data.session_id}/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(persistBody)
          }).catch(() => {});
          return data.session_id;
        }
        return null;
      })
      .catch(() => null);
  }

  function navigateSession(dir) {
    // dir: 'prev' -> older, 'next' -> newer
    if (!sessions || sessions.length === 0 || !activeSession) return;
    const idx = sessions.findIndex((s) => s.id === activeSession);
    if (idx === -1) return;
    let newIdx = idx;
    if (dir === 'prev') newIdx = Math.min(sessions.length - 1, idx + 1);
    if (dir === 'next') newIdx = Math.max(0, idx - 1);
    if (newIdx !== idx) {
      const s = sessions[newIdx];
      if (s) setActiveSession(s.id);
    }
  }

  async function persistMessageAndSend(userText) {
    // Ensure a session exists; create one if needed
    let sessionId = activeSession;
    if (!sessionId) {
      sessionId = await createSession();
      if (sessionId) {
        // setActiveSession already called in createSession, but keep local id
      } else {
        // If session creation failed, proceed without persistence but still send to model
        sessionId = null;
      }
    }

    const user = { from: "user", text: userText, timestamp: new Date().toISOString() };
    setMessages((m) => [...m, user]);

    // persist user message if we have a session id (include user_email when available)
    if (sessionId) {
      const persistBody = email ? { message: user, user_email: email } : { message: user };
      fetch(`${API}/api/chat/session/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(persistBody),
      }).catch(() => {});
    }

    // send to model endpoint
    setIsTyping(true);
    try {
      const r = await fetch(`${API}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userText }),
      });
      const data = await r.json();
      const replyText = data.response || "(No response)";
      const bot = { from: "bot", text: replyText, timestamp: new Date().toISOString() };
      setMessages((m) => [...m, bot]);

      // persist bot reply to session store as well (include user_email when available)
      if (sessionId) {
        const persistBody = email ? { message: bot, user_email: email } : { message: bot };
        fetch(`${API}/api/chat/session/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(persistBody),
        }).catch(() => {});
      }
    } catch (err) {
      setMessages((m) => [...m, { from: "bot", text: "(Error contacting server)" }]);
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
    <div className="max-w-5xl mx-auto px-4 sm:px-6 p-6">
      <div className="relative rounded-2xl shadow-lg overflow-hidden bg-white/10 backdrop-blur-sm border border-white/20">
        <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Support Chat</h2>
            <p className="text-sm text-gray-500 mt-1">Supportive strategies only — not a crisis or medical service. Chat history is saved per session.</p>
          </div>
          <div className="flex items-center gap-2">
            <button className={btnNeutral} onClick={() => { setShowModal(true); fetch(`${API}/api/chat/session${sessionsQuery}`).then(r=>r.json()).then(d=>setSessions(d.sessions||[])).catch(()=>{}); }}>History</button>
            <button className={btnNeutral} onClick={createSession} title="Create new session">New session</button>
          </div>
        </div>

        <div className="md:flex">
          <div className="flex-1 p-4 sm:p-6">
            <div ref={containerRef} className="h-[60vh] md:h-[56vh] overflow-y-auto space-y-4 bg-transparent p-4 rounded-lg">
              {messages.map((m, i) => (
                <div key={i} className={`flex items-start gap-3 ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                  {m.from === "bot" && (
                    <div className="flex-shrink-0">
                      <div className="w-9 h-9 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold">B</div>
                    </div>
                  )}

                  <div className={`max-w-[78%] px-4 py-2 rounded-xl shadow-sm ${m.from === "user" ? "bg-blue-600 text-white rounded-br-none" : "bg-white text-gray-800 rounded-bl-none border"}`}>
                    <div className="whitespace-pre-wrap leading-relaxed">{m.text}</div>
                  </div>

                  {m.from === "user" && (
                    <div className="flex-shrink-0">
                      <div className="w-9 h-9 bg-blue-600 text-white rounded-full flex items-center justify-center font-semibold">Y</div>
                    </div>
                  )}
                </div>
              ))}
              {isTyping && (
                <div className="flex items-start gap-3">
                  <div className="flex-shrink-0">
                    <div className="w-9 h-9 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold">B</div>
                  </div>
                  <div className="max-w-[78%] px-4 py-2 rounded-xl bg-white text-gray-500 rounded-bl-none border italic">Generating...</div>
                </div>
              )}
            </div>

            <div className="mt-4">
                <textarea
                className="w-full border rounded-lg p-3 min-h-[56px] resize-none focus:ring-2 focus:ring-blue-300"
                placeholder="Type a message (Shift+Enter for newline)..."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                // allow typing even when session isn't created yet; a session will be auto-created on Send
              />

              <div className="flex items-center justify-between m-1">
                <div className="text-xs text-gray-500 m-2">You can type anytime — a session will be created when you send your first message.</div>
                <div className="flex items-center gap-2">
                  <button className={btnNeutral} onClick={() => setInput("")}>Clear</button>
                  <button className={btnPrimary} onClick={send}>Send</button>
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
          onClose={() => setShowModal(false)}
          onOpen={(id) => openSession(id)}
            onDelete={(id) => {
            // call server to delete, then refresh sessions list
            fetch(`${API}/api/chat/session/${id}`, { method: 'DELETE' })
              .then((r) => {
                if (r.ok) {
                  // refresh sessions
                  fetch(`${API}/api/chat/session${sessionsQuery}`).then(rr => rr.json()).then(d => {
                    setSessions(d.sessions || []);
                    if (activeSession === id) setActiveSession(null);
                  }).catch(() => {
                    setSessions((s) => s.filter(x => x.id !== id));
                    if (activeSession === id) setActiveSession(null);
                  });
                } else {
                  // if delete failed, still remove locally
                  setSessions((s) => s.filter(x => x.id !== id));
                  if (activeSession === id) setActiveSession(null);
                }
              })
              .catch(() => {
                setSessions((s) => s.filter(x => x.id !== id));
                if (activeSession === id) setActiveSession(null);
              });
          }}
        />
      )}
    </div>
  );
}

// Note: Modal markup is rendered at the end of the component; since this file is JSX and returns above,
// we instead inject the modal via a portal-like conditional rendering above. To keep edits minimal,
// we add a small helper component-like fragment that will be mounted by React when showModal is true.
export function ChatbotModal({ sessions, onClose, onOpen, onDelete }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* clickable dimmed backdrop with blur */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full mx-4 sm:mx-auto max-w-lg bg-white backdrop-blur-md border border-white/20 rounded-xl shadow-2xl p-4 sm:p-6 max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Session history</h3>
          <button className={`${btnNeutral} px-2 py-1 text-sm`} onClick={onClose}>Close</button>
        </div>

        <div className="space-y-2 max-h-[68vh] overflow-auto">
          {sessions.length === 0 && <div className="text-sm text-black">No sessions found</div>}
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between border border-white/6 p-3 rounded bg-white/6">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-black truncate">
                  <span className="font-mono">{`Chat_${s.id}`}</span>
                </div>
                <div className="text-xs text-gray-600 truncate">{s.lastMessage ? (s.lastMessage.text || 'Message') : 'Empty session'}</div>
              </div>
              <div className="flex items-center gap-2 ml-4">
                <button className={`${btnGhost} px-2`} onClick={() => onOpen(s.id)}>Open</button>
                <button className="text-xs text-red-400 px-2" onClick={() => onDelete(s.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
