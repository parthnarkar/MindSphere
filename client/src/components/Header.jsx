import React, { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";


export default function Header({ user, onLogout, onShowPhq9 }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // close mobile menu on route change
    setMobileOpen(false);
  }, [location.pathname]);

  const baseLink = ({ isActive }) =>
    `px-3 py-2 rounded-md text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30 focus:ring-offset-2 focus:ring-offset-white ${isActive
      ? "text-[#FF8C42] font-semibold"
      : "text-[#90A4AE] hover:text-[#263238]"
    }`;

  const actionClass =
    "px-3 py-2 rounded-md text-sm font-medium text-[#263238] hover:text-[#FF8C42] transition focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30 focus:ring-offset-2 focus:ring-offset-white";

  const adminNav = (
    <>
      <button
        onClick={() => navigate("/admin-dashboard")}
        className={actionClass}
      >
        Dashboard
      </button>
      <button
        onClick={() => {
          navigate("/admin-dashboard");
          setTimeout(() => {
            const el = document.getElementById("counsellor");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }, 150);
        }}
        className={actionClass}
      >
        Counsellor
      </button>
      <button
        onClick={() => {
          navigate("/admin-dashboard");
          setTimeout(() => {
            const el = document.getElementById("user");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }, 150);
        }}
        className={actionClass}
      >
        User
      </button>
      <button
        onClick={() => {
          navigate("/admin-dashboard");
          setTimeout(() => {
            const el = document.getElementById("overview");
            if (el) el.scrollIntoView({ behavior: "smooth" });
          }, 150);
        }}
        className={actionClass}
      >
        Overview
      </button>
    </>
  );

  const defaultNav = (
    <>
      <NavLink to="/chatbot" className={baseLink}>
        Chat
      </NavLink>
      <NavLink to="/peer-to-peer" className={baseLink}>
        Forum
      </NavLink>
      <NavLink
        to="#"
        onClick={() => onShowPhq9 && onShowPhq9()}
        className={actionClass}
      >
        Screening
      </NavLink>
      <NavLink to="/booking" className={baseLink}>
        Booking
      </NavLink>
      <NavLink to="/resources" className={baseLink}>
        Resources
      </NavLink>
    </>
  );


  const counsellorNav = (
    <NavLink to="/CounsellorDashboard" className={baseLink}>
      Dashboard
    </NavLink>
  );

  return (
    <header className="fixed inset-x-0 top-4 z-50 pointer-events-auto">
      <div className="max-w-7xl mx-auto rounded-xl shadow-xl bg-white/70 backdrop-blur-sm border border-gray-200">
        <div className="flex items-center justify-between h-16 px-4 sm:px-6">
          {/* Left: Logo + Menu */}
          <div className="flex items-center gap-3">
            <button
              className="md:hidden p-2 rounded focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label="Toggle menu"
            >
              <svg
                className="w-6 h-6 text-[#FF8C42]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={
                    mobileOpen
                      ? "M6 18L18 6M6 6l12 12"
                      : "M4 6h16M4 12h16M4 18h16"
                  }
                />
              </svg>
            </button>

            <NavLink
              to="/"
              className="flex items-center gap-3 focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30"
            >
              <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center shadow-sm border border-gray-100">
                <img
                  src="/mindsphere-logo.png"
                  alt="MindSphere"
                  className="w-7 h-7"
                />
              </div>
              <span className="text-xl md:text-2xl font-extrabold text-[#263238]">
                MindSphere
              </span>
            </NavLink>
          </div>

          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center gap-4">
            {user?.role === "admin"
              ? adminNav
              : user?.role === "counsellor"
                ? counsellorNav
                : defaultNav}
          </nav>

          {/* Right side: Profile + Logout */}
          <div className="flex items-center gap-3">
            {/* Profile Avatar */}
            {user && (
              <button
                onClick={() => {
                  if (user.role === "user") navigate("/profile"); // 👈 admin profile page
                  else if (user.role === "counsellor") navigate("/CounsellorProfile"); // 👈 counsellor profile page
                  // else navigate("/profile"); // 👤 default user profile page
                }}
                className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-[#FF8C42] shadow-md hover:scale-105 transition"
                title="Your Profile"
              >
                {user.role === "admin" ? (
                  <img
                    src="/admin.png"
                    alt="Admin"
                    className="object-cover w-8 h-8"
                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/mindsphere-logo.png'; }}
                  />
                ) : user.photoURL ? (
                  <img
                    src={user.photoURL}
                    alt="Profile"
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/mindsphere-logo.png'; }}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-[#FF8C42] text-white font-bold text-lg">
                    {user.email?.[0]?.toUpperCase() || "U"}
                  </div>
                )}
              </button>
            )}


            {/* Logout */}
            <button
              onClick={() => onLogout && onLogout()}
              className="px-3 py-1 rounded-md bg-white/70 text-[#263238] font-semibold hover:bg-white border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white/70">
            <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2 rounded-b-2xl">
              {user?.role === "admin"
                ? adminNav
                : user?.role === "counsellor"
                  ? counsellorNav
                  : defaultNav}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
