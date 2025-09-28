import { useState, useRef, useEffect } from "react";
import { API } from "../hooks/helper";

export default function Chatbot() {
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

  // Load recent sessions once on mount
  useEffect(() => {
    fetch(`${API}/api/chat/session`)
      .then((r) => r.json())
      .then((data) => {
        const sess = data.sessions || [];
        setSessions(sess);
        if (sess.length > 0 && !activeSession) setActiveSession(sess[0].id);
      })
      .catch(() => setSessions([]));
  }, []);

  // Load messages for active session
  useEffect(() => {
    if (!activeSession) {
      setMessages([
        { from: "bot", text: "Hi — I'm a supportive assistant. How can I help today?" },
      ]);
      return;
    }
    fetch(`${API}/api/chat/session/${activeSession}/messages`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data.messages) && data.messages.length) {
          setMessages(data.messages.map((m) => ({ ...m })));
        } else {
          setMessages([
            { from: "bot", text: "Hi — I'm a supportive assistant. How can I help today?" },
          ]);
        }
      })
      .catch(() => {
        // ignore
      });
  }, [activeSession]);

  function createSession() {
    // Return a Promise that resolves with the created session id (or null)
    return fetch(`${API}/api/chat/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
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
          // persist opener (best-effort)
          fetch(`${API}/api/chat/session/${data.session_id}/messages`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ message: bot })
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

    // persist user message if we have a session id
    if (sessionId) {
      fetch(`${API}/api/chat/session/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: user }),
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

      // persist bot reply to session store as well
      if (sessionId) {
        fetch(`${API}/api/chat/session/${sessionId}/messages`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: bot }),
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
      <div className="bg-white rounded-2xl shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b flex items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Support Chat</h2>
            <p className="text-sm text-gray-500 mt-1">Supportive strategies only — not a crisis or medical service. Chat history is saved per session.</p>
          </div>
            <div className="flex items-center gap-2">
            <button className="px-3 py-2 bg-gray-100 rounded" onClick={() => { setShowModal(true); fetch(`${API}/api/chat/session`).then(r=>r.json()).then(d=>setSessions(d.sessions||[])).catch(()=>{}); }}>History</button>
            <button className="px-3 py-2 bg-gray-100 rounded" onClick={createSession} title="Create new session">New session</button>
          </div>
        </div>

        <div className="md:flex">
          <div className="flex-1 p-4 sm:p-6">
            <div ref={containerRef} className="h-[60vh] md:h-[56vh] overflow-y-auto space-y-4 bg-gray-50 p-4 rounded-lg border">
              {messages.map((m, i) => (
                <div key={i} className={`flex items-start gap-3 ${m.from === "user" ? "justify-end" : "justify-start"}`}>
                  {m.from === "bot" && (
                    <div className="flex-shrink-0">
                      <div className="w-9 h-9 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold">B</div>
                    </div>
                  )}

                  <div className={`max-w-[78%] px-4 py-2 rounded-lg ${m.from === "user" ? "bg-blue-600 text-white rounded-br-none" : "bg-white text-gray-800 rounded-bl-none border"}`}>
                    <div className="whitespace-pre-wrap">{m.text}</div>
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
                  <div className="max-w-[78%] px-4 py-2 rounded-lg bg-white text-gray-500 rounded-bl-none border italic">Generating...</div>
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

              <div className="flex items-center justify-between mt-3">
                  <div className="text-xs text-gray-500">You can type anytime — a session will be created when you send your first message.</div>
                <div className="flex items-center gap-2">
                  <button
                    className="px-4 py-2 rounded-md bg-gray-100 hover:bg-gray-200 text-sm"
                      onClick={() => setInput("")}
                  >
                    Clear
                  </button>
                  <button
                    className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-sm"
                    onClick={send}
                      
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </div>

          <aside className="w-full md:w-72 border-t md:border-t-0 md:border-l mt-4 md:mt-0 md:block">
            <div className="p-6">
              <h3 className="font-semibold mb-3">Sessions & tips</h3>
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs text-gray-500">Sessions</div>
                  <div className="flex items-center gap-2">
                    <button className="text-xs text-gray-600 px-2 py-1 border rounded" onClick={() => setViewHistory((v) => !v)}>{viewHistory ? 'Hide history' : 'View history'}</button>
                    <button className="text-xs text-white bg-blue-600 px-2 py-1 rounded" onClick={createSession}>New session</button>
                  </div>
                </div>

                {viewHistory ? (
                  <div className="space-y-2">
                    {sessions.length === 0 && <div className="text-sm text-gray-500">No saved sessions</div>}
                    {sessions.map((s, idx) => (
                      <div key={s.id} className={`flex items-center justify-between p-2 rounded ${s.id === activeSession ? 'bg-blue-50' : ''}`}>
                        <div className="text-sm truncate">{s.lastMessage ? (s.lastMessage.text || 'Message') : 'Empty session'}</div>
                        <div className="flex items-center gap-2">
                          <button className="text-xs text-blue-600" onClick={() => setActiveSession(s.id)}>Open</button>
                        </div>
                      </div>
                    ))}
                    {sessions.length > 0 && (
                      <div className="flex items-center justify-between mt-2">
                        <button className="px-2 py-1 border rounded text-sm" onClick={() => navigateSession('prev')}>Older</button>
                        <div className="text-xs text-gray-500">{sessions.findIndex(s => s.id === activeSession) >= 0 ? `${sessions.findIndex(s => s.id === activeSession) + 1} of ${sessions.length}` : ''}</div>
                        <button className="px-2 py-1 border rounded text-sm" onClick={() => navigateSession('next')}>Newer</button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sessions.length === 0 && <div className="text-sm text-gray-500">No saved sessions</div>}
                    {sessions.slice(0,4).map((s) => (
                      <div key={s.id} className="flex items-center justify-between">
                        <div className="text-sm truncate">{s.lastMessage ? (s.lastMessage.text || 'Message') : 'Empty session'}</div>
                        <div className="flex items-center gap-2">
                          <button className="text-xs text-blue-600" onClick={() => setActiveSession(s.id)}>Open</button>
                        </div>
                      </div>
                    ))}
                    {sessions.length > 4 && <div className="text-xs text-gray-500">...{sessions.length - 4} more</div>}
                  </div>
                )}
              </div>

              <h4 className="font-semibold mb-2">Tips for a supportive chat</h4>
              <ul className="text-sm space-y-2 text-gray-600">
                <li>Be honest and specific about how you're feeling.</li>
                <li>Ask for coping strategies or resources.</li>
                <li>If you're in immediate danger, call your local emergency number.</li>
              </ul>

              <div className="mt-6 bg-blue-50 p-3 rounded">
                <div className="font-medium text-sm">Crisis resources</div>
                <div className="text-xs text-gray-600 mt-1">If you need urgent help, contact local emergency services or a crisis helpline.</div>
              </div>
            </div>
          </aside>
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
                  fetch(`${API}/api/chat/session`).then(rr => rr.json()).then(d => {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-40">
      <div className="w-full max-w-2xl bg-white rounded-lg shadow-lg p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold">Session history</h3>
          <button className="px-2 py-1 text-sm" onClick={onClose}>Close</button>
        </div>
        <div className="space-y-2 max-h-96 overflow-auto">
          {sessions.length === 0 && <div className="text-sm text-gray-500">No sessions found</div>}
          {sessions.map((s) => (
            <div key={s.id} className="flex items-center justify-between border p-2 rounded">
              <div className="text-sm truncate">{s.lastMessage ? (s.lastMessage.text || 'Message') : 'Empty session'}</div>
              <div className="flex items-center gap-2">
                <button className="text-xs text-blue-600" onClick={() => onOpen(s.id)}>Open</button>
                <button className="text-xs text-red-500" onClick={() => onDelete(s.id)}>Delete</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
