import React, { useState, useRef, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';

export default function Header({ user, onLogout, onShowPhq9 }) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const firstFocusableRef = useRef(null);
  const navigate = useNavigate();
  const location = useLocation();

  const adminLinkClass = 'px-2 py-1 rounded text-left w-full md:w-auto text-gray-700 hover:text-blue-600 transition truncate whitespace-nowrap';

  const navigateToSection = (id) => {
    // close mobile menu if open
    setOpen(false);
    // if already on admin dashboard, scroll to section
    if (location.pathname === '/admin-dashboard') {
      if (!id) {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        return;
      }
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    // otherwise navigate there first, then scroll shortly after
    navigate('/admin-dashboard');
    if (!id) return;
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
  };

  // Close on Escape and manage focus
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      // focus first focusable element in the panel
      setTimeout(() => {
        try {
          const focusTarget = panelRef.current?.querySelector('a,button');
          if (focusTarget) focusTarget.focus();
        } catch { /* ignore */ }
      }, 50);
      // prevent body scroll when menu open
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
  }, [open]);

  const linkClass = ({ isActive }) =>
    `px-2 py-1 rounded text-left w-full md:w-auto ${isActive ? 'text-blue-700 font-semibold' : 'text-gray-700 hover:text-blue-600'} transition truncate whitespace-nowrap`;

  return (
    // fixed header at top
    <header className="fixed inset-x-0 top-0 bg-white shadow z-50 overflow-hidden">
      <div className="max-w-6xl mx-auto flex items-center justify-between h-16 px-4 sm:px-6">
        <div className="flex items-center gap-4">
          <button
            className="md:hidden p-2 rounded-md flex-shrink-0"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={open}
            aria-controls="main-navigation"
            ref={firstFocusableRef}
          >
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={open ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} />
            </svg>
          </button>
          <NavLink to="/" className="text-2xl md:text-3xl font-extrabold text-blue-700 tracking-wide drop-shadow flex-shrink-0">MindSphere</NavLink>
        </div>

        {/* Desktop nav */}
        <nav id="main-navigation" className="hidden md:flex flex-1 justify-center">
          <div className="flex items-center gap-x-8 text-base sm:text-lg font-medium min-w-0 overflow-hidden">
            {user?.role === 'counsellor' ? (
              <NavLink to="/CounsellorDashboard" className={linkClass}>Dashboard</NavLink>
            ) : user?.role === 'admin' ? (
              // Keep same styling but change tabs for admin
              <>
                <button onClick={() => navigateToSection('')} className={linkClass}>Dashboard</button>
                <button onClick={() => navigateToSection('counsellor')} className={linkClass}>Councellor</button>
                <button onClick={() => navigateToSection('user')} className={linkClass}>User</button>
                <button onClick={() => navigateToSection('overview')} className={linkClass}>Overview</button>
              </>
            ) : (
              <>
                <NavLink to="/chatbot" className={linkClass}>Chat</NavLink>
                <NavLink to="/peer-to-peer" className={linkClass}>Forum</NavLink>
                <button onClick={onShowPhq9} className="px-2 py-1 text-gray-700 hover:text-blue-600 transition rounded">Screening</button>
                <NavLink to="/booking" className={linkClass}>Booking</NavLink>
                <NavLink to="/resources" className={linkClass}>Resources</NavLink>
              </>
            )}
          </div>
        </nav>

        {/* Mobile slide-over menu & overlay */}
        {open && (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/30" onClick={() => setOpen(false)} aria-hidden="true" />
            {/* place panel below the fixed header and stretch to bottom */}
            <div ref={panelRef} style={{ top: '4rem', bottom: 0 }} className="absolute left-0 w-3/4 max-w-xs bg-white shadow-lg p-4 transform transition-transform translate-x-0 overflow-y-auto box-border">
              <div className="flex items-center justify-between mb-4">
                <div className="text-lg font-semibold">Menu</div>
                <button onClick={() => setOpen(false)} aria-label="Close menu" className="p-2">✕</button>
              </div>
              <div className="flex flex-col gap-2">
                {user?.role === 'counsellor' ? (
                  <NavLink to="/CounsellorDashboard" className={linkClass} onClick={() => setOpen(false)}>Dashboard</NavLink>
                ) : user?.role === 'admin' ? (
                  <>
                    <button onClick={() => { setOpen(false); navigateToSection(''); }} className={adminLinkClass}>Dashboard</button>
                    <button onClick={() => { setOpen(false); navigateToSection('counsellor'); }} className={adminLinkClass}>Councellor</button>
                    <button onClick={() => { setOpen(false); navigateToSection('user'); }} className={adminLinkClass}>User</button>
                    <button onClick={() => { setOpen(false); navigateToSection('overview'); }} className={adminLinkClass}>Overview</button>
                  </>
                ) : (
                  <>
                    <NavLink to="/chatbot" className={linkClass} onClick={() => setOpen(false)}>Chat</NavLink>
                    <NavLink to="/peer-to-peer" className={linkClass} onClick={() => setOpen(false)}>Forum</NavLink>
                    <button onClick={() => { setOpen(false); onShowPhq9(); }} className="px-2 py-1 text-gray-700 hover:text-blue-600 transition text-left">Screening</button>
                    <NavLink to="/booking" className={linkClass} onClick={() => setOpen(false)}>Booking</NavLink>
                    <NavLink to="/resources" className={linkClass} onClick={() => setOpen(false)}>Resources</NavLink>
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="flex-shrink-0 flex items-center">
          <button
            onClick={() => { setOpen(false); onLogout(); }}
            className="px-3 py-1 rounded bg-red-50 text-red-600 font-semibold hover:bg-red-100 hover:underline transition text-sm"
          >
            Logout
          </button>
        </div>
      </div>
    </header>
  );
}
