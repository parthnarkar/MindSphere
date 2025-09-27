import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import AuthPage from "./pages/Authentication";
import Chatbot from "./pages/Chatbot";
import Screening from "./pages/Screening";
import Booking from "./pages/Booking";
import Forum from "./pages/Forum";
import Resources from "./pages/Resources";
import Admin from "./pages/Admin";
import PeerToPeer from "./pages/Peer-to-Peer";
import CounsellorDashboard from "./pages/CounsellorDashboard";
import { onAuthChange, logoutUser } from "./services/auth";
import PHQ9Modal from "./components/PHQ9Modal";
import { API } from "./hooks/helper";
import { db } from "./firebase";
import { collection, getDocs } from "firebase/firestore";
import Header from "./components/Header";
import CounsellorsGrid from "./components/CounsellorsGrid";
import { PrivateRoute, CounsellorRoute } from "./components/ProtectedRoutes";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [counsellors, setCounsellors] = useState([]);
  const [showPhq9, setShowPhq9] = useState(false);
  const [phq9Checked, setPhq9Checked] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange((currentUser) => {
      setUser(currentUser);
      setLoading(false);
      // Show immediately after login for non-counsellor; will auto-close if recent submission exists
      if (currentUser) {
        // Only show PHQ modal for signed-up users who are not counsellors
        if (currentUser.signedUp && currentUser.role !== "counsellor") {
          setShowPhq9(true);
        } else {
          setShowPhq9(false);
        }
        setPhq9Checked(false);
      } else {
        setShowPhq9(false);
        setPhq9Checked(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Check PHQ-9 last submission; show modal if none in last 7 days
  useEffect(() => {
    const checkPhq9 = async () => {
      if (!user || phq9Checked || user.role === "counsellor") return;
      try {
        const base = API || "http://localhost:5000";
        const url = `${base.replace(/\/$/, "")}/api/phq9/${encodeURIComponent(user.email)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("phq9 fetch failed");
        const data = await res.json();
        if (data && data.timestamp) {
          const ts = new Date(data.timestamp);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (ts >= sevenDaysAgo) {
            // Recent submission — close the modal
            setShowPhq9(false);
          } else {
            // Older than 7 days — keep showing
            setShowPhq9(true);
          }
        } else {
          // No record — keep showing
          setShowPhq9(true);
        }
      } catch (_) {
        // On error, do not block; allow modal to show
        setShowPhq9(true);
      } finally {
        setPhq9Checked(true);
      }
    };
    checkPhq9();
  }, [user, phq9Checked]);

  const handleLogout = async () => {
    await logoutUser();
    setUser(null);
  };

  const PrivateRoute = ({ children }) => {
    // Require authenticated and signed-up users (role can be 'user' or other non-null)
    return user && user.signedUp && user.role ? children : <Navigate to="/" />;
  };

  const CounsellorRoute = ({ children }) => {
    return user && user.signedUp && user.role === "counsellor" ? children : <Navigate to="/" />;
  };

  if (loading) return <div>Loading...</div>;

  // Route component that opens the PHQ9 modal instead of rendering Screening page
  function ScreenModalRoute() {
    useEffect(() => {
      if (user && user.role !== "counsellor") setShowPhq9(true);
    }, []);
    return null;
  }

  return (
    <div className="min-h-screen bg-black text-gray-900">
      {/* Header */}
      {user && <Header user={user} onLogout={handleLogout} onShowPhq9={() => setShowPhq9(true)} />}

      {/* PHQ-9 Modal */}
      {user && user.role !== "counsellor" && showPhq9 && (
        <PHQ9Modal
          user={user}
          open={showPhq9}
          onClose={() => setShowPhq9(false)}
          onSubmitted={() => setShowPhq9(false)}
        />
      )}


      <main className="max-w-8xl mx-auto">
        <Routes>
          {/* Login / Redirect */}
          <Route
            path="/"
            element={
              // If not logged in, show auth page
              !user ? (
                <AuthPage />
              ) : (
                // If logged in but not signed up, redirect to auth/signup for completion
                !user.signedUp ? (
                  <AuthPage />
                ) : // signed-up: route by role
                user.role === "counsellor" ? (
                  <Navigate to="/CounsellorDashboard" />
                ) : (
                  <Navigate to="/chatbot" />
                )
              )
            }
          />
          <Route path="/login" element={<AuthPage />} />

          {/* Protected Pages */}
          <Route path="/chatbot" element={<PrivateRoute user={user}><Chatbot /></PrivateRoute>} />
          <Route
            path="/peer-to-peer" element={<PrivateRoute user={user}><PeerToPeer /></PrivateRoute>} />
          <Route path="/screening" element={<PrivateRoute user={user}><Screening /></PrivateRoute>} />
          <Route path="/booking" element={<PrivateRoute user={user}><Booking counsellors={counsellors} /></PrivateRoute>} />
          <Route path="/forum" element={<PrivateRoute user={user}><Forum /></PrivateRoute>} />
          <Route path="/resources" element={<PrivateRoute user={user}><Resources /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute user={user}><Admin /></PrivateRoute>} />

          {/* Counsellor-only route */}
          <Route path="/CounsellorDashboard" element={<CounsellorRoute user={user}><CounsellorDashboard /></CounsellorRoute>} />
        </Routes>
        <CounsellorsGrid counsellors={counsellors} />
      </main>
    </div>
  );
}

export default App;