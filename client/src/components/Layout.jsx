import React from 'react';

export default function Layout({ children }) {
  return (
    // make the page a column flex so footer stays at bottom and main grows
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      {/* main should grow; layout-level paddings removed so pages are full-bleed */}
      <main className="flex-1 w-full overflow-x-hidden">
        {children}
      </main>
    </div>
  );
}
