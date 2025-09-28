import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import AuthPage from "./pages/Authentication";
import Chatbot from "./pages/Chatbot";
import Booking from "./pages/Booking";
import Resources from "./pages/Resources";
import AdminDashboard from "./pages/AdminDashboard";
import PeerToPeer from "./pages/Peer-to-Peer";
import CounsellorDashboard from "./pages/CounsellorDashboard";
import { onAuthChange, logoutUser } from "./services/auth";
import PHQ9Modal from "./components/PHQ9Modal";
import { API } from "./hooks/helper";
import Header from "./components/Header";
import Layout from "./components/Layout";
import CounsellorsGrid from "./components/CounsellorsGrid";
import { PrivateRoute, CounsellorRoute, AdminRoute } from "./components/ProtectedRoutes";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialAuthChecked, setInitialAuthChecked] = useState(false);
  // counsellors list is populated by other pages; setCounsellors is unused here
  const [counsellors, _setCounsellors] = useState([]);
  const [showPhq9, setShowPhq9] = useState(false);
  const [phq9Checked, setPhq9Checked] = useState(false);
  const [firstLoginCandidate, setFirstLoginCandidate] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange((currentUser) => {
      setUser(currentUser);
      setLoading(false);
      // mark that the initial auth check completed so we don't show the
      // full-screen loader on subsequent auth changes (prevents flicker)
      setInitialAuthChecked(true);
      // Show immediately after login for non-counsellor; will auto-close if recent submission exists
      if (currentUser) {
          // Only show PHQ modal for signed-up users who are regular 'user' accounts. Show it
          // only when the session 'firstLogin' flag is set (set at signup/login time).
          if (currentUser.signedUp && currentUser.role === "user") {
          // Do NOT set showPhq9 here (avoids visual flicker). Instead record if the
          // session indicates first-login; the checkPhq9 effect will decide
          // whether to show the modal after verifying the server state.
          const isFirstLogin =
            currentUser.signedUp &&
              currentUser.role === "user" &&
            !!sessionStorage.getItem("firstLogin");
          setFirstLoginCandidate(isFirstLogin);
          // reset phq9Checked so the check effect runs
          setPhq9Checked(false);
          // ensure modal is hidden until the check completes
          setShowPhq9(false);
        } else {
          setShowPhq9(false);
        }
        setPhq9Checked(false);
      } else {
        setShowPhq9(false);
        setPhq9Checked(false);
        setFirstLoginCandidate(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Check PHQ-9 last submission; show modal if none in last 7 days
  useEffect(() => {
    const checkPhq9 = async () => {
      // Only run the check when we have a user and we haven't already checked,
      // and only if the session indicated this is a first-login candidate.
      if (
        !user ||
        phq9Checked ||
        user.role !== "user" ||
        !firstLoginCandidate
      )
        return;
      try {
        const base = API;
        const url = `${base.replace(/\/$/, "")}/api/phq9/${encodeURIComponent(
          user.email
        )}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("phq9 fetch failed");
        const data = await res.json();
        if (data && data.timestamp) {
          const ts = new Date(data.timestamp);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (ts >= sevenDaysAgo) {
            setShowPhq9(false);
          } else {
            setShowPhq9(true);
          }
        } else {
          setShowPhq9(true);
        }
      } catch (e) {
        // If the check errors, do not forcibly show the modal — hide it to avoid flicker.
        console.warn("PHQ check failed:", e);
        setShowPhq9(false);
      } finally {
        setPhq9Checked(true);
      }
    };
    checkPhq9();
  }, [user, phq9Checked, firstLoginCandidate]);

  const handleLogout = async () => {
    await logoutUser();
    setUser(null);
  };

  const PrivateRoute = ({ children }) => {
    // Require authenticated and signed-up users (role can be 'user' or other non-null)
    return user && user.signedUp && user.role ? children : <Navigate to="/" />;
  };

  const CounsellorRoute = ({ children }) => {
    return user && user.signedUp && user.role === "counsellor" ? (
      children
    ) : (
      <Navigate to="/" />
    );
  };

  if (loading && !initialAuthChecked) {
    // Well Designed Logo Flicker Linear Loading State
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="text-center">
          <img src="/mindsphere-logo.png" alt="Loading..." className="animate-pulse h-25 w-25 mx-auto" />
        </div>
      </div>
    );
  }

  // Route component that opens the PHQ9 modal instead of rendering Screening page
  function ScreenModalRoute() {
    useEffect(() => {
      if (user && user.role !== "counsellor") setShowPhq9(true);
    }, []);
    return null;
  }

  return (
    <Layout
      user={user}
      onLogout={handleLogout}
      onShowPhq9={() => setShowPhq9(true)}
    >
      {/* PHQ-9 Modal (only for regular users) */}
      {user && user.role === "user" && showPhq9 && (
        <PHQ9Modal
          user={user}
          open={showPhq9}
          onClose={() => setShowPhq9(false)}
          onSubmitted={() => setShowPhq9(false)}
        />
      )}

      <Routes>
        {/* Login / Redirect */}
        <Route
          path="/"
          element={
            // If not logged in, show auth page
            !user ? (
              <AuthPage />
            ) : // If logged in but not signed up, redirect to auth/signup for completion
            !user.signedUp ? (
              <AuthPage />
            ) : // signed-up: route by role
            user.role === "admin" ? (
              <Navigate to="/admin-dashboard" />
            ) : user.role === "counsellor" ? (
              <Navigate to="/CounsellorDashboard" />
            ) : (
              <Navigate to="/chatbot" />
            )
          }
        />
        <Route path="/login" element={<AuthPage />} />
  {/* admin-login now uses the unified AuthPage with defaultRole='admin' */}
  {/* /admin-login removed - unified auth route at '/' handles all roles */}

        {/* Protected Pages */}
        <Route
          path="/chatbot"
          element={
            <PrivateRoute user={user}>
              <Chatbot user={user} />
            </PrivateRoute>
          }
        />
        <Route
          path="/peer-to-peer"
          element={
            <PrivateRoute user={user}>
              <PeerToPeer />
            </PrivateRoute>
          }
        />
        <Route
          path="/booking"
          element={
            <PrivateRoute user={user}>
              <Booking counsellors={counsellors} />
            </PrivateRoute>
          }
        />
        <Route
          path="/resources"
          element={
            <PrivateRoute user={user}>
              <Resources />
            </PrivateRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute user={user}>
              <AdminDashboard />
            </AdminRoute>
          }
        />

        {/* Admin-only routes */}
        <Route
          path="/admin-dashboard"
          element={
            <AdminRoute user={user}>
              <AdminDashboard />
            </AdminRoute>
          }
        />

        {/* Counsellor-only route */}
        <Route
          path="/CounsellorDashboard"
          element={
            <CounsellorRoute user={user}>
              <CounsellorDashboard />
            </CounsellorRoute>
          }
        />
      </Routes>
      <CounsellorsGrid counsellors={counsellors} />
      
      {/* Toast Container */}
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
    </Layout>
  );
}

export default App;
