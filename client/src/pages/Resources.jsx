import React, { useEffect, useState } from "react";
import { API } from "../hooks/helper";

const FALLBACK = [
  { id: 1, title: "Intro to coping skills", type: "video", language: "English", url: "" },
  { id: 2, title: "How to support a friend", type: "video", language: "Hindi", url: "" },
  { id: 3, title: "Offline resource map", type: "guide", language: "Regional", url: "" },
];

export default function Resources() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const base = API || "http://localhost:5000";
    const url = `${base.replace(/\/$/, "")}/api/resources`;

    fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error(`Status ${r.status}`);
        return r.json();
      })
      .then((data) => {
        // Expecting data.resources or an array response
        const list = data?.resources ?? data ?? [];
        setItems(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        setError(err.message || "Failed to fetch");
        setItems(FALLBACK);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Resource Library</h2>
      <div className="bg-white p-4 rounded shadow">
        {loading && <div className="text-sm text-gray-600">Loading resources...</div>}
        {error && <div className="text-sm text-red-600">{error} — showing fallback resources.</div>}

        <ul className="mt-3 space-y-3">
          {items.map((it) => (
            <li key={it.id} className="border p-3 rounded">
              <div className="font-medium">{it.title}</div>
              <div className="text-sm text-gray-600">{it.type} — {it.language}</div>
              {it.url ? (
                <div className="mt-2">
                  <a href={it.url} target="_blank" rel="noreferrer" className="text-blue-600">Open</a>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
