import { useState } from "react";
import { API } from "../hooks/helper";

export default function Booking() {
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const [ok, setOk] = useState(null);

  function book() {
    fetch(`${API}/api/bookings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, time }),
    })
      .then((r) => r.json())
      .then(() => setOk(true))
      .catch(() => setOk(false));
  }

  return (
    <div>
      <h2 className="text-2xl font-semibold mb-4">Confidential Counseling Booking</h2>
      <div className="bg-white p-4 rounded shadow max-w-md">
        <label className="block mb-2">Preferred name (anonymous ok)
          <input className="w-full border rounded px-2 py-1 mt-1" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block mb-2">Preferred time
          <input className="w-full border rounded px-2 py-1 mt-1" type="datetime-local" value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
        <div className="mt-3">
          <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={book}>Request Booking</button>
        </div>

        {ok && <div className="mt-3 text-sm text-green-700">Booking requested (prototype). Data should be encrypted in production.</div>}
        {ok === false && <div className="mt-3 text-sm text-red-700">Failed to request booking (check backend).</div>}
      </div>
    </div>
  );
}
