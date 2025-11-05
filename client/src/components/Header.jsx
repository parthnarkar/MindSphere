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

  // Consolidated role value used throughout the header (authoritative user.role preferred)
  const roleVal = (user && user.role) || fallbackRole;

  // When there's no firebase `user` but an optimistic role in sessionStorage
  // (set by the admin login flow), allow header to behave for admin sessions.
  const isAdminFallback = !user && fallbackRole === 'admin';

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

  // Admin sees a single Dashboard link to keep header compact and focused
  const adminNav = (
    <NavLink to="/admin-dashboard" className={actionClass}>
      Admin Dashboard
    </NavLink>
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

  // Small helper to render avatar images consistently in desktop and mobile
  function AvatarImage({ role = 'user', size = 'w-10 h-10' }) {
    const src = role === 'admin' ? '/admin.png' : '/user.png';
    const onError = (e) => {
      try {
        e.currentTarget.onerror = null;
        e.currentTarget.src = '/mindsphere-logo.png';
      } catch (err) {
        // ignore
      }
    };

    // For admin, render the image as a background cover so it fills the
    // circular profile container nicely (works better for rectangular logos).
    if (role === 'admin') {
      return (
        <div
          role="img"
          aria-label="Admin"
          className={`${size} bg-center bg-cover bg-no-repeat`
          }
          style={{ backgroundImage: `url("${src}")` }}
        />
      );
    }

    return (
      <img
        src={src}
        alt={role === 'admin' ? 'Admin' : 'Profile'}
        className={`${size} object-cover`}
        onError={onError}
      />
    );
  }

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
                <nav className="hidden md:flex items-center gap-1 whitespace-nowrap md:overflow-visible overflow-x-auto">
                  {/* Show adminNav when role is admin; otherwise show counsellor or default nav */}
                  {roleVal === 'admin' ? (
                    adminNav
                  ) : (
                    roleVal === 'counsellor' ? counsellorNav : defaultNav
                  )}
                </nav>

                <div className="hidden md:flex items-center gap-1">
                {user && (
                  <button
                    onClick={() => {
                      // Navigate to appropriate profile/dashboard depending on role
                      if (user.role === "user") navigate("/profile");
                      else if (user.role === "counsellor") navigate("/CounsellorDashboard");
                      else if (user.role === "admin") navigate("/admin-dashboard");
                    }}
                    className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-[#FF8C42] shadow-md hover:scale-105 transition flex-shrink-0"
                    title="Your Profile"
                    aria-label="Your profile"
                  >
                    <AvatarImage role={user.role} size={'w-10 h-10'} />
                  </button>
                )}

                {isAdminFallback && (
                  <button
                    onClick={() => navigate('/admin-dashboard')}
                    className="relative w-10 h-10 rounded-full overflow-hidden border-2 border-[#FF8C42] shadow-md hover:scale-105 transition flex-shrink-0"
                    title="Admin Dashboard"
                    aria-label="Admin dashboard"
                  >
                    <AvatarImage role={'admin'} size={'w-10 h-10'} />
                  </button>
                )}

                <button onClick={() => {
                  if (onLogout) {
                    onLogout();
                  } else {
                    try { sessionStorage.removeItem('authRole'); } catch(e) {}
                    navigate('/landing');
                  }
                }} className="px-3 py-1 rounded-md bg-white text-[#263238] font-semibold hover:bg-gray-50 border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30">Logout</button>
              </div>
            </>
          ) : (
            // Unauthenticated: show Get Started only when there's no optimistic
            // fallback role in sessionStorage. This ensures the CTA is visible
            // only for truly unauthenticated users and appears only once.
            (!user && !fallbackRole) ? (
              <div className="flex items-center gap-2">
                <button onClick={() => navigate('/auth')} className="p-2 m-2 rounded-md bg-[#FF8C42] text-white font-semibold hover:bg-[#e6732f] focus:outline-none focus:ring-2 focus:ring-[#FF8C42]/30 text-sm md:text-lg">Get Started</button>
              </div>
            ) : null
          )}
          </div>

          {(mobileOpen && roleVal) && (
            <div id="main-navigation" className="md:hidden border-t border-gray-200 bg-white">
              <div className="max-w-6xl mx-auto w-full box-border px-4 py-3 flex flex-col gap-2 rounded-b-2xl max-h-[70vh] sm:max-h-[60vh] overflow-y-auto">
                {/* Links for mobile: show appropriate nav; admins see adminNav */}
                {roleVal === 'admin' ? adminNav : (roleVal === 'counsellor' ? counsellorNav : defaultNav)}

                {/* If authenticated, show profile and logout in mobile menu */}
                {(user || isAdminFallback) && (
                  <div className="mt-2 pt-2 border-t border-gray-100">
                    <button
                      onClick={() => {
                        setMobileOpen(false);
                        if (user) {
                          if (user.role === 'counsellor') navigate('/CounsellorDashboard');
                          else if (user.role === 'admin') navigate('/admin-dashboard');
                          else navigate('/profile');
                        } else if (isAdminFallback) {
                          navigate('/admin-dashboard');
                        }
                      }}
                      className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left hover:bg-gray-50"
                      aria-label="Open profile"
                    >
                      <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-[#FF8C42] shadow-md">
                        <AvatarImage role={user ? user.role : 'admin'} size={'w-10 h-10'} />
                      </div>
                      <div className="text-sm font-medium text-[#263238]">Profile</div>
                    </button>
                    <button
                      onClick={() => {
                        setMobileOpen(false);
                        if (onLogout) {
                          onLogout();
                        } else {
                          try { sessionStorage.removeItem('authRole'); } catch (e) {}
                          navigate('/landing');
                        }
                      }}
                      className="mt-2 w-full px-3 py-2 rounded-md bg-white text-[#263238] font-semibold hover:bg-gray-50 border border-gray-200 text-sm"
                    >
                      Logout
                    </button>
                  </div>
                )}

                
              </div>
            </div>
          )}
      </div>
    </header>
  );
}
