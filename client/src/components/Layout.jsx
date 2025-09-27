import React from 'react';
import Header from './Header';
import Footer from './Footer';

export default function Layout({ user, onLogout, onShowPhq9, children }) {
  return (
    // make the page a column flex so footer stays at bottom and main grows
    <div className="min-h-screen flex flex-col bg-gray-50 text-gray-900">
      {/* Header (fixed) */}
      {user && <Header user={user} onLogout={onLogout} onShowPhq9={onShowPhq9} />}

      {/* main should grow and be offset by header height when header is present */}
      <main className={`flex-1 max-w-8xl mx-auto w-full px-4 sm:px-6 lg:px-8 ${user ? 'pt-16' : ''}`}>
        {children}
      </main>

      <Footer />
    </div>
  );
}
