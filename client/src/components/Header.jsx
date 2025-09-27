import React from 'react';
import { Link } from 'react-router-dom';

export default function Header({ user, onLogout, onShowPhq9 }) {
  return (
    <header className="bg-white shadow mb-4">
      <div className="max-w-6xl mx-auto flex items-center justify-between py-4 px-6">
        <span className="text-3xl font-extrabold text-blue-700 tracking-wide drop-shadow flex-shrink-0">
          MindSphere
        </span>

        <nav className="flex-1 flex justify-center">
          <div className="flex items-center gap-x-8 text-lg font-medium">
            {user.role === "counsellor" ? (
              <>
                <Link to="/CounsellorDashboard" className="hover:text-blue-500 transition">
                  Dashboard
                </Link>
              </>
            ) : (
              <>
                <Link to="/chatbot" className="hover:text-blue-500 transition">
                  Chat
                </Link>
                <Link to="/peer-to-peer" className="hover:text-blue-500 transition">
                  Peer-to-Peer
                </Link>
                <button onClick={onShowPhq9} className="hover:text-blue-500 cursor-pointer transition text-left">
                  Screening
                </button>
                <Link to="/booking" className="hover:text-blue-500 transition">
                  Booking
                </Link>
                <Link to="/resources" className="hover:text-blue-500 transition">
                  Resources
                </Link>
              </>
            )}
          </div>
        </nav>

        <div className="flex-shrink-0 flex items-center">
          <button
            onClick={onLogout}
            className="px-4 py-1 rounded bg-red-50 text-red-600 font-semibold hover:bg-red-100 hover:underline transition"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
