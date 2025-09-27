import { useEffect, useState } from "react";
import { API } from "../hooks/helper";

export default function Admin() {
  const [metrics, setMetrics] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/admin`).then((r) => r.json()).then(setMetrics);
  }, []);

  if (!metrics) return <div className="px-4 sm:px-6 py-6">Loading metrics...</div>;

  return (
    <div className="px-4 sm:px-6">
      <h2 className="text-2xl font-semibold mb-4">Admin Dashboard (Anonymous)</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-500">Active users (anon)</div>
          <div className="text-2xl font-bold">{metrics.activeUsers}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-500">Screenings</div>
          <div className="text-2xl font-bold">{metrics.screenings}</div>
        </div>
        <div className="bg-white p-4 rounded shadow">
          <div className="text-sm text-gray-500">Bookings</div>
          <div className="text-2xl font-bold">{metrics.bookings}</div>
        </div>
      </div>

      <div className="mt-4">
        <button className="bg-gray-700 text-white px-3 py-1 rounded">Export anonymized CSV (prototype)</button>
      </div>
    </div>
  );
}
