import { useState } from "react";
import { API } from "../hooks/helper";

export default function Forum() {
  const [posts, setPosts] = useState([
    { id: 1, text: "Anyone else feeling overwhelmed during exams?", anon: true },
  ]);
  const [text, setText] = useState("");

  function submit() {
    if (!text.trim()) return;
    fetch(`${API}/api/forum`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    })
      .then((r) => r.json())
      .then((newPost) => {
        setPosts((p) => [newPost, ...p]);
        setText("");
      })
      .catch(() => {
        // silent for prototype
      });
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Anonymous Peer Forum (Moderated)</h2>
      <div className="bg-white p-4 rounded shadow mb-4">
        <textarea className="w-full border rounded p-2" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Share anonymously..." />
        <div className="mt-2 text-right">
          <button className="bg-indigo-600 text-white px-3 py-1 rounded" onClick={submit}>Post</button>
        </div>
      </div>

      <div className="space-y-3">
        {posts.map((p) => (
          <div key={p.id} className="bg-white p-3 rounded shadow">
            <div className="text-sm text-gray-600">Anonymous</div>
            <div className="mt-1">{p.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
