import React from 'react';

export default function CounsellorsGrid({ counsellors }) {
  if (!counsellors || counsellors.length === 0) return null;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
      {counsellors.map((c) => (
        <div key={c.id} className="bg-white shadow rounded-lg p-6 flex flex-col items-center">
          <div className="text-xl font-bold text-blue-700 mb-2">{c.name}</div>
          <div className="text-gray-700 mb-1">{c.specialization}</div>
          <div className="text-sm text-gray-500 mb-2">{c.email}</div>
        </div>
      ))}
    </div>
  );
}
