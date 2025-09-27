import React from 'react';
import Header from './Header';
import Footer from './Footer';

export default function Layout({ user, onLogout, onShowPhq9, children }) {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      {user && <Header user={user} onLogout={onLogout} onShowPhq9={onShowPhq9} />}

      <main className="max-w-8xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {children}
      </main>

      <Footer />
    </div>
  );
}
