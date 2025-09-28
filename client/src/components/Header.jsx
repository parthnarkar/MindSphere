import React, { useState, useEffect } from 'react';
import { NavLink, useNavigate, useLocation } from 'react-router-dom';

export default function Header({ user, onLogout, onShowPhq9 }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // close mobile menu on route change
    setMobileOpen(false);
  }, [location.pathname]);

  const baseLink = ({ isActive }) =>
    `px-3 py-2 rounded ${isActive ? 'text-blue-700 font-semibold' : 'text-gray-700 hover:text-blue-600'} transition`;
  const actionClass = 'px-3 py-2 rounded text-gray-700 hover:text-blue-600 transition';

  const adminNav = (
    <>
      <button onClick={() => navigate('/admin-dashboard')} className={actionClass}>Dashboard</button>
      <button onClick={() => { navigate('/admin-dashboard'); setTimeout(()=>{ const el = document.getElementById('counsellor'); if(el) el.scrollIntoView({behavior:'smooth'}); }, 150); }} className={actionClass}>Counsellor</button>
      <button onClick={() => { navigate('/admin-dashboard'); setTimeout(()=>{ const el = document.getElementById('user'); if(el) el.scrollIntoView({behavior:'smooth'}); }, 150); }} className={actionClass}>User</button>
      <button onClick={() => { navigate('/admin-dashboard'); setTimeout(()=>{ const el = document.getElementById('overview'); if(el) el.scrollIntoView({behavior:'smooth'}); }, 150); }} className={actionClass}>Overview</button>
    </>
  );

  const defaultNav = (
    <>
      <NavLink to="/chatbot" className={baseLink}>Chat</NavLink>
      <NavLink to="/peer-to-peer" className={baseLink}>Forum</NavLink>
      <NavLink to="#" onClick={() => onShowPhq9 && onShowPhq9()} className={actionClass}>Screening</NavLink>
      <NavLink to="/booking" className={baseLink}>Booking</NavLink>
      <NavLink to="/resources" className={baseLink}>Resources</NavLink>
    </>
  );

  const counsellorNav = (
    <NavLink to="/CounsellorDashboard" className={baseLink}>Dashboard</NavLink>
  );

  return (
    <header className="fixed inset-x-0 top-0 bg-white shadow z-50">
      <div className="max-w-6xl mx-auto flex items-center justify-between h-16 px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <button className="md:hidden p-2 rounded" onClick={() => setMobileOpen(o => !o)} aria-label="Toggle menu">
            <svg className="w-6 h-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={mobileOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'} /></svg>
          </button>
          <NavLink to="/" className="text-2xl font-extrabold text-blue-700">MindSphere</NavLink>
        </div>

        {/* Desktop links */}
        <nav className="hidden md:flex items-center gap-4">
          {user?.role === 'admin' ? adminNav : user?.role === 'counsellor' ? counsellorNav : defaultNav}
        </nav>

        <div className="flex items-center gap-3">
          <button onClick={() => onLogout && onLogout()} className="px-3 py-1 rounded bg-red-50 text-red-600 font-semibold hover:bg-red-100 text-sm">Logout</button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <div className="md:hidden bg-white border-t shadow-sm">
          <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2">
            {user?.role === 'admin' ? adminNav : user?.role === 'counsellor' ? counsellorNav : defaultNav}
            {/* mobile logout removed per request - desktop Logout remains */}
          </div>
        </div>
      )}
    </header>
  );
}
