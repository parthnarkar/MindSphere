import { useState } from "react";
import { API } from "../hooks/helper";

export default function Chatbot() {
  const [messages, setMessages] = useState([
    { from: "bot", text: "Hi — I'm an anonymous, stigma-free supporter. How can I help today?" },
  ]);
  const [input, setInput] = useState("");

  function send() {
    if (!input.trim()) return;
    const user = { from: "user", text: input };
    setMessages((m) => [...m, user]);
    setInput("");

    const base = API;
    const url = `${base.replace(/\/$/, "")}/api/chat`;

    // show typing indicator
    setMessages((m) => [...m, { from: "bot", text: "..." }]);

    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: user.text }),
    })
      .then((r) => r.json())
      .then((data) => {
        // remove typing indicator (last bot message) and append real reply
        setMessages((m) => {
          const withoutTyping = m.slice(0, -1);
          return [...withoutTyping, { from: "bot", text: data.reply || "(no reply)" }];
        });
      })
      .catch((err) => {
        setMessages((m) => {
          const withoutTyping = m.slice(0, -1);
          return [...withoutTyping, { from: "bot", text: "(Error contacting server)" }];
        });
      });
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Anonymous Chatbot</h2>
      <div className="border rounded p-4 h-80 overflow-y-auto bg-white">
        {messages.map((m, i) => (
          <div key={i} className={`mb-2 ${m.from === "user" ? "text-right" : "text-left"}`}>
            <div className={`inline-block px-3 py-2 rounded ${m.from === "user" ? "bg-blue-100" : "bg-gray-100"}`}>
              {m.text}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 flex gap-2">
        <input
          className="flex-1 border rounded px-3 py-2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type message (prototype)..."
        />
        <button className="bg-blue-600 text-white px-4 rounded" onClick={send}>
          Send
        </button>
      </div>

      <p className="text-sm text-gray-500 mt-3">Prototype bot — integrate with a safe LLM and human-in-loop for production.</p>
    </div>
  );
}
