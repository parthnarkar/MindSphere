import { Routes, Route, Navigate, Link, useLocation, useNavigate } from "react-router-dom";
import { useState, useEffect, useRef } from "react";
import LandingPage from "./pages/LandingPage"; // Import the new landing page
import AuthPage from "./pages/Authentication";
import Chatbot from "./pages/Chatbot";
import Booking from "./pages/Booking";
import Resources from "./pages/Resources";
import AdminDashboard from "./pages/AdminDashboard";
import PeerToPeer from "./pages/Peer-to-Peer";
import CounsellorDashboard from "./pages/CounsellorDashboard";
import Profile from "./pages/Profile";
import { onAuthChange, logoutUser } from "./services/auth";
import PHQ9Modal from "./components/PHQ9Modal";
import { API } from "./hooks/helper";
import Layout from "./components/Layout";
import Header from "./components/Header";
import Footer from "./components/Footer";
import PageTransition from "./components/PageTransition";
import { PrivateRoute, CounsellorRoute, AdminRoute } from "./components/ProtectedRoutes";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import LogoLoader from "./components/LogoLoader";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialAuthChecked, setInitialAuthChecked] = useState(false);
  const [counsellors, _setCounsellors] = useState([]);
  const [showPhq9State, setShowPhq9State] = useState(() => {
    try {
      return sessionStorage.getItem('phq9Open') === '1';
    } catch (e) {
      return false;
    }
  });
  // wrapper so we persist open state across refreshes
  const setShowPhq9 = (v) => {
    try {
      if (v) sessionStorage.setItem('phq9Open', '1');
      else sessionStorage.removeItem('phq9Open');
    } catch (e) {
      // ignore storage errors
    }
    setShowPhq9State(v);
  };
  const [phq9Checked, setPhq9Checked] = useState(false);
  const [firstLoginCandidate, setFirstLoginCandidate] = useState(false);
  const [pageReady, setPageReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange((currentUser) => {
      // when auth state changes: for sign-in, keep the pageReady=false so
      // the global loader remains while role-based pages hydrate. For
      // sign-out, ensure pageReady is true so the app doesn't get stuck
      // on the loading overlay when returning to public/landing routes.
      setUser(currentUser);
      setLoading(false);
      setInitialAuthChecked(true);
      if (currentUser) {
        setPageReady(false);
      } else {
        // on logout, mark the page ready so the loader hides immediately.
        setPageReady(true);
      }
        if (currentUser) {
          if (currentUser.signedUp && currentUser.role === "user") {
            const isFirstLogin = !!sessionStorage.getItem("firstLogin");
            setFirstLoginCandidate(isFirstLogin);
            setPhq9Checked(false);
            // keep persisted showPhq9 value (if user had it open before refresh)
          } else {
            // non-user roles shouldn't have PHQ-9 open
            setShowPhq9(false);
          }
      } else {
        setShowPhq9(false);
        setPhq9Checked(false);
        setFirstLoginCandidate(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // When the authoritative auth state arrives, navigate to the correct role landing
  // This centralizes navigation so we don't flash the wrong role UI before the
  // authenticated user object is available.
  const navigate = useNavigate();
  const loc = useLocation();
  const autoNavRef = useRef(false);
  useEffect(() => {
    if (!user) {
      // reset so next login can auto-navigate
      autoNavRef.current = false;
      return;
    }
    if (autoNavRef.current) return;
    // Only auto-navigate if the user is currently on a generic entry route
    // (root, landing, or auth). If the user has already navigated to a
    // specific page (e.g. /peer-to-peer), respect that and do not override it.
    const currentPath = loc && loc.pathname ? loc.pathname.toLowerCase() : '';
    const isEntryRoute = currentPath === '/' || currentPath === '/landing' || currentPath === '/auth';
    if (!isEntryRoute) {
      // user intentionally navigated to a page -> do not auto-redirect
      autoNavRef.current = true; // mark handled so we don't re-run
      return;
    }
    // navigate according to authoritative role (run only once per login)
    try {
      if (user.role === 'admin') {
        navigate('/admin-dashboard', { replace: true });
      } else if (user.role === 'counsellor') {
        navigate('/CounsellorDashboard', { replace: true });
      } else {
        navigate('/chatbot', { replace: true });
      }
      autoNavRef.current = true;
    } catch (_) {
      // navigation may fail in tests/SSR — ignore
    }
  }, [user, navigate]);

  // Do not reset `pageReady` on every route change. We want to avoid showing
  // the top-level loader while navigating between pages. The loader will still
  // appear during initial auth loading or when the authoritative auth state
  // changes (onAuthChange sets pageReady false), but normal route transitions
  // will not trigger the overlay.

  useEffect(() => {
    // PHQ9 checks should be initiated only when the user explicitly requests
    // screening (via the header 'Screening' button). Do not open the modal
    // automatically on login or page load — keep this effect inert.
  }, [user, phq9Checked, firstLoginCandidate]);

  // Keep the app-level "pageReady" flag false until the current page signals
  // that it's fully rendered by dispatching 'mindsphere:pageReady'. This prevents
  // the top-level loader from disappearing until page content (role-based)
  // has finished its initial data loading and rendering.
  useEffect(() => {
    let readyTimeout = null;
    let bufferTimeout = null;
    const onPageReady = () => {
      // Buffer the ready flag slightly to avoid tight paint/layout races that
      // can create a subtle flicker when the loader hides and the page renders.
      if (bufferTimeout) clearTimeout(bufferTimeout);
      bufferTimeout = setTimeout(() => {
        setPageReady(true);
        bufferTimeout = null;
      }, 80);
      if (readyTimeout) { clearTimeout(readyTimeout); readyTimeout = null; }
    };
    window.addEventListener('mindsphere:pageReady', onPageReady);
  // fallback: don't block forever — mark ready after a short timeout
  // Shortened from 10s to 4s to avoid long stuck loaders during auth transitions
  readyTimeout = setTimeout(() => { setPageReady(true); }, 4000);

    return () => {
      window.removeEventListener('mindsphere:pageReady', onPageReady);
      if (readyTimeout) clearTimeout(readyTimeout);
      if (bufferTimeout) clearTimeout(bufferTimeout);
    };
  }, []);

  // Expose small global so layout/header can synchronously style during loading.
  useEffect(() => {
    try { window.__mindsphere_pageReady = pageReady; } catch (_) { /* ignore */ }
  }, [pageReady]);

  const handleLogout = async () => {
    try {
      await logoutUser();
    } catch (e) {
      // best-effort logout — continue to clear local state even if remote call fails
      console.warn('logoutUser failed', e);
    }
    setUser(null);
  try { sessionStorage.removeItem('authRole'); } catch(_) { /* ignore */ }
  try { navigate('/landing', { replace: true }); } catch (_) { /* ignore navigation errors in tests/SSR */ }
  };

  if (loading && !initialAuthChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <LogoLoader active={true} minDuration={2000} size={96} text={"Preparing your setup"} overlay overlayOpacity={1} blockInteraction={true} />
      </div>
    );
  }

  // This component will render the main app layout for authenticated users
  // Build a provisional displayUser so routes (ProtectedRoute) can render correctly
  // Allow the header/nav to show an optimistic role instantly (from sessionStorage),
  // but for routing decisions prefer the authoritative `user` object only. This
  // prevents transient navigation to the wrong role (eg. user) before the real
  // Firebase auth state arrives.
  // For best UX we show header/navigation only based on authoritative auth state.
  // Avoid using sessionStorage fallback to prevent transient incorrect role displays.
  const displayUserHeader = user;
  const displayUser = user; // authoritative for routing

  const AuthenticatedLayout = () => (
    <Layout>
      {/* Top-level logo overlay: keep showing until pageReady (page dispatches 'mindsphere:pageReady') */}
      {/* Use an opaque overlay and block interactions so users don't see a transparent transition */}
  <LogoLoader active={!pageReady} minDuration={2000} size={120} text={"Preparing your setup"} overlay overlayOpacity={1} blockInteraction={true} />
      {displayUser && displayUser.role === "user" && showPhq9State && (
        <PHQ9Modal
          user={displayUser}
          open={showPhq9State}
          onClose={() => setShowPhq9(false)}
          onSubmitted={() => setShowPhq9(false)}
        />
      )}
      <PageTransition>
        <Routes>
      <Route path="/landing" element={<LandingPage />} />
            {/* Login / Redirect */}
        <Route path="/" element={<Navigate to="/landing" replace />} />
        <Route path="/auth" element={<AuthPage />} />
  {/* admin-login now uses the unified AuthPage with defaultRole='admin' */}
  {/* /admin-login removed - unified auth route at '/' handles all roles */}

        {/* Protected Pages */}
        <Route
          path="/chatbot"
          element={
            <PrivateRoute user={displayUser}>
              <Chatbot user={displayUser} />
            </PrivateRoute>
          }
        />
        <Route
          path="/peer-to-peer"
          element={
            <PrivateRoute user={displayUser}>
              <PeerToPeer />
            </PrivateRoute>
          }
        />
        <Route
          path="/booking"
          element={
            <PrivateRoute user={displayUser}>
              <Booking counsellors={counsellors} />
            </PrivateRoute>
          }
        />
        <Route
          path="/resources"
          element={
            <PrivateRoute user={displayUser}>
              <Resources />
            </PrivateRoute>
          }
        />

        <Route
          path="/profile"
          element={
            <PrivateRoute user={displayUser}>
              <Profile />
            </PrivateRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <AdminRoute user={displayUser}>
              <AdminDashboard />
            </AdminRoute>
          }
        />

        {/* <Route
          path="/Adminprofile"
          element={
            <AdminRoute user={user}>
              <AdminProfile />
            </AdminRoute>
          }
        /> */}


        {/* Admin-only routes */}
        <Route
          path="/admin-dashboard"
          element={
            <AdminRoute user={displayUser}>
              <AdminDashboard />
            </AdminRoute>
          }
        />

        {/* Counsellor-only route */}
        <Route
          path="/CounsellorDashboard"
          element={
            <CounsellorRoute user={displayUser}>
              <CounsellorDashboard />
            </CounsellorRoute>
          }
        />

        <Route
          path="/CounsellorProfile"
          element={
            <CounsellorRoute user={displayUser}>
              <CounsellorDashboard />
            </CounsellorRoute>
          }
        />
      </Routes>
      </PageTransition>
    </Layout>
  );

  // This component will render routes for unauthenticated users
  const UnauthenticatedLayout = () => (
    <Layout>
      <Routes>
        <Route path="/landing" element={<LandingPage />} />
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth" element={<AuthPage />} />
        {/* Redirect any other route to the landing page */}
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </Layout>
  );

  const hideShell = loc.pathname === '/auth';

  return (
    <>
      {/* Single Header/Footer shell mounted once. Hidden on auth screens */}
      {!hideShell && <Header user={displayUserHeader} onLogout={handleLogout} onShowPhq9={() => setShowPhq9(true)} />}

      {/* Mount Layout once so header/footer and page container do not remount during route/auth changes */}
      <Layout>
        {/* Top-level logo overlay: keep showing until pageReady (page dispatches 'mindsphere:pageReady') */}
        <LogoLoader active={!pageReady} minDuration={2000} size={120} text={"Preparing your setup"} overlay overlayOpacity={1} blockInteraction={true} />
        {displayUser && displayUser.role === "user" && showPhq9State && (
          <PHQ9Modal
            user={displayUser}
            open={showPhq9State}
            onClose={() => setShowPhq9(false)}
            onSubmitted={() => setShowPhq9(false)}
          />
        )}

        <PageTransition>
          <Routes>
            <Route path="/landing" element={<LandingPage />} />
            {/* Login / Redirect */}
            <Route path="/" element={<Navigate to="/landing" replace />} />
            <Route path="/auth" element={<AuthPage />} />

            {/* Protected Pages */}
            <Route
              path="/chatbot"
              element={
                <PrivateRoute user={displayUser}>
                  <Chatbot user={displayUser} />
                </PrivateRoute>
              }
            />
            <Route
              path="/peer-to-peer"
              element={
                <PrivateRoute user={displayUser}>
                  <PeerToPeer />
                </PrivateRoute>
              }
            />
            <Route
              path="/booking"
              element={
                <PrivateRoute user={displayUser}>
                  <Booking counsellors={counsellors} />
                </PrivateRoute>
              }
            />
            <Route
              path="/resources"
              element={
                <PrivateRoute user={displayUser}>
                  <Resources />
                </PrivateRoute>
              }
            />

            <Route
              path="/profile"
              element={
                <PrivateRoute user={displayUser}>
                  <Profile />
                </PrivateRoute>
              }
            />

            <Route
              path="/admin"
              element={
                <AdminRoute user={displayUser}>
                  <AdminDashboard />
                </AdminRoute>
              }
            />

            {/* Admin-only routes */}
            <Route
              path="/admin-dashboard"
              element={
                <AdminRoute user={displayUser}>
                  <AdminDashboard />
                </AdminRoute>
              }
            />

            {/* Counsellor-only route */}
            <Route
              path="/CounsellorDashboard"
              element={
                <CounsellorRoute user={displayUser}>
                  <CounsellorDashboard />
                </CounsellorRoute>
              }
            />

            <Route
              path="/CounsellorProfile"
              element={
                <CounsellorRoute user={displayUser}>
                  <CounsellorDashboard />
                </CounsellorRoute>
              }
            />

            {/* Fallback: unauthenticated -> landing, authenticated -> role landing */}
            <Route
              path="*"
              element={
                displayUser
                  ? displayUser.role === 'admin'
                    ? <Navigate to="/admin-dashboard" />
                    : displayUser.role === 'counsellor'
                      ? <Navigate to="/CounsellorDashboard" />
                      : <Navigate to="/chatbot" />
                  : <Navigate to="/landing" />
              }
            />
          </Routes>
        </PageTransition>
      </Layout>

      {!hideShell && <Footer />}

      <ToastContainer
        position="top-right"
        autoClose={5000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
        toastClassName="custom-toast"
        bodyClassName="custom-toast-body"
        progressClassName="custom-toast-progress"
      />
    </>
  );
}

export default App;
