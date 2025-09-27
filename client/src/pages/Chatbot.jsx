import { useState, useRef, useEffect } from "react";
import { API } from "../hooks/helper";

export default function Chatbot() {
  const [messages, setMessages] = useState([
    { from: "bot", text: "Hi — I'm an anonymous, stigma-free supporter. How can I help today?" },
  ]);
  const [isTyping, setIsTyping] = useState(false);
  const [input, setInput] = useState("");
  const containerRef = useRef(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // first welcome message is intentionally hardcoded locally; subsequent replies come from the server model


  function send() {
    if (!input.trim()) return;
  const user = { from: "user", text: input.trim() };
    setMessages((m) => [...m, user]);
    setInput("");

    const url = `${API}/api/chat`;
    // show typing indicator
    setIsTyping(true);

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: user.text }),
    })
      .then((r) => r.json())
      .then((data) => {
        // append real reply
        setMessages((m) => {
          const reply = data.response || "";
          return [...m, { from: "bot", text: reply }];
        });
      })
      .catch((err) => {
        setMessages((m) => [...m, { from: "bot", text: "(Error contacting server)" }]);
      })
      // hide typing indicator regardless of outcome
      .finally(() => setIsTyping(false));
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
        <div className="px-6 py-4 border-b">
          <h2 className="text-2xl font-semibold">Anonymous Chatbot</h2>
          <p className="text-sm text-gray-500 mt-1">Supportive strategies only — not a crisis or medical service.</p>
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
                    {/* intent labels are detected on server now; client UI shows only text */}
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
              />

              <div className="flex items-center justify-between mt-3">
                <div className="text-xs text-gray-500">Your messages are anonymous in this demo.</div>
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
              <h3 className="font-semibold mb-3">Tips for a supportive chat</h3>
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
    </div>
  );
}
