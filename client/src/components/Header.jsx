import React, { useState, useEffect } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";


export default function Header({ user, onLogout, onShowPhq9 }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  // Read optimistic role from sessionStorage synchronously so header doesn't flicker
  let fallbackRole = null;
  try {
    const r = typeof window !== 'undefined' ? sessionStorage.getItem('authRole') : null;
    if (r) fallbackRole = r;
  } catch (err) { /* ignore */ }

  useEffect(() => {
    // close mobile menu on route change
    setMobileOpen(false);
  }, [location.pathname]);

  // Close mobile menu on Escape for accessibility
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && mobileOpen) setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  

  // Shared nav item classes for consistent styling across header links/buttons
  const navItemBase = "px-3 py-2 rounded-md text-sm font-medium transition focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30 focus:ring-offset-2 focus:ring-offset-white";
  const navItemInactive = "text-[#90A4AE] hover:text-[#263238]";

  // Only apply hover styles for links; remove active styling so links do not
  // visually change when active. Keep consistent padding/focus behavior.
  const baseLink = () => `${navItemBase} ${navItemInactive}`;

  const actionClass = `${navItemBase} text-[#263238] hover:text-[#FF8C42]`;

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
        className={baseLink}
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

  // Read global pageReady flag (set by App) to decide if header should be glassy or solid
  let pageReadyFlag = true;
  try { if (typeof window !== 'undefined') pageReadyFlag = !!window.__mindsphere_pageReady; } catch(e) { pageReadyFlag = true; }

  // If the page isn't ready, render a compact header (logo + title only) to avoid
  // layout shifts when the loader hides. When ready, render the full header.
  return (
    <header className="fixed inset-x-0 top-4 z-50 pointer-events-auto m-2">
  <div className={`max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 rounded-xl shadow-xl bg-white border border-gray-200`}>
        <div className="flex items-center justify-between h-16 px-2">
          <div className="flex items-center gap-2">
            {/* Hamburger for responsive nav (placed before logo) - only shown for authenticated users or optimistic role */}
            {((user && user.role) || fallbackRole) ? (
              <button
                aria-label={mobileOpen ? "Close menu" : "Open menu"}
                aria-expanded={mobileOpen}
                aria-controls="main-navigation"
                onClick={() => setMobileOpen(!mobileOpen)}
                className="p-2 rounded-md bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30 md:hidden"
              >
                {!mobileOpen ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 6h18M3 12h18M3 18h18" stroke="#263238" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M6 6l12 12M6 18L18 6" stroke="#263238" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </button>
            ) : null}

            {/* On Logo Click Go to Landing Page */}
            <NavLink to="/landing" className="flex items-center gap-2 focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30">
              <div className="w-10 h-10 rounded-xl bg-white flex-shrink-0 flex items-center justify-center shadow-sm border border-gray-100">
                <img src="/mindsphere-logo.png" alt="MindSphere" className="w-7 h-7" />
              </div>
              <span className="text-xl md:text-2xl font-extrabold text-[#263238]">MindSphere</span>
            </NavLink>
          </div>

          {/* If there's an authenticated user or an optimistic fallback role, show the full nav
              but only when the page is ready. For unauthenticated users, always show the
              minimal CTA (Get Started) regardless of the pageReadyFlag to avoid a missing
              CTA during loading. */}
          {((user && user.role) || fallbackRole) ? (
            // Authenticated or optimistic role: always show nav/profile to avoid disappearing links
            <>
              <nav className="hidden md:flex items-center gap-2 whitespace-nowrap md:overflow-visible overflow-x-auto">
                {((user && user.role) || fallbackRole) === "admin"
                  ? adminNav
                  : ((user && user.role) || fallbackRole) === "counsellor"
                    ? counsellorNav
                    : defaultNav}
              </nav>

              <div className="hidden md:flex items-center gap-2">
                {user && (
                  <button
                    onClick={() => {
                      // Do not change route when counsellor clicks their avatar.
                      if (user.role === "user") navigate("/profile");
                      else if (user.role === "counsellor") return; // noop for counsellors
                      else if (user.role === "admin") navigate("/admin-dashboard");
                    }}
                    className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-[#FF8C42] shadow-md hover:scale-105 transition flex-shrink-0"
                    title="Your Profile"
                  >
                        {user.role === "admin" ? (
                          <img src="/admin.png" alt="Admin" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/mindsphere-logo.png'; }} />
                        ) : (
                          <img src="/user.png" alt="Profile" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/mindsphere-logo.png'; }} />
                        )}
                  </button>
                )}

                <button onClick={() => onLogout && onLogout()} className="px-3 py-1 rounded-md bg-white text-[#263238] font-semibold hover:bg-gray-50 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30">Logout</button>
              </div>
            </>
          ) : (
            // Unauthenticated: always show Get Started CTA regardless of pageReadyFlag
            <div className="flex items-center gap-2">
              <button onClick={() => navigate('/auth')} className="px-4 py-2 rounded-md bg-[#FF8C42] text-white font-semibold hover:bg-[#e6732f] focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30">Get Started</button>
            </div>
          )}
          </div>

          {(mobileOpen && ((user && user.role) || fallbackRole)) && (
            <div id="main-navigation" className="md:hidden border-t border-gray-200 bg-white">
              <div className="max-w-6xl mx-auto w-full box-border px-4 py-3 flex flex-col gap-2 rounded-b-2xl max-h-[70vh] sm:max-h-[60vh] overflow-y-auto">
                {/* Links for mobile: show appropriate nav */}
                {((user && user.role) || fallbackRole) === "admin" ? adminNav : ((user && user.role) || fallbackRole) === "counsellor" ? counsellorNav : defaultNav}

                {/* If authenticated, show profile and logout in mobile menu */}
                {user && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <button onClick={() => { setMobileOpen(false); if (user.role !== 'counsellor') navigate('/profile'); }} className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-gray-50">
                      <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[#FF8C42] shadow-md">
                        {user.role === "admin" ? (
                          <img src="/admin.png" alt="Admin" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/mindsphere-logo.png'; }} />
                        ) : (
                          <img src="/user.png" alt="Profile" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/mindsphere-logo.png'; }} />
                        )}
                      </div>
                      <div className="text-sm font-medium text-[#263238]">Profile</div>
                    </button>
                    <button onClick={() => { setMobileOpen(false); onLogout && onLogout(); }} className="mt-2 w-full px-3 py-2 rounded-md bg-white text-[#263238] font-semibold hover:bg-gray-50 border border-gray-200 text-sm">Logout</button>
                  </div>
                )}

                {/* Unauthenticated users: show Get Started in mobile panel */}
                {!user && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <button onClick={() => { setMobileOpen(false); navigate('/auth'); }} className="w-full px-3 py-2 rounded-md bg-[#FF8C42] text-white font-semibold hover:bg-[#e6732f]">Get Started</button>
                  </div>
                )}
              </div>
            </div>
          )}
      </div>
    </header>
  );
}
