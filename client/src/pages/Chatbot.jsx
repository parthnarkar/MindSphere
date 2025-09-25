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
    // prototype: echo bot with safe-response placeholder
    setTimeout(() => {
      setMessages((m) => [
        ...m,
        { from: "bot", text: `I hear you. (Prototype reply) — you said: "${user.text}"` },
      ]);
    }, 700);
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
