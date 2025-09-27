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
        if (currentUser.role !== "counsellor") {
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
    return user ? children : <Navigate to="/" />;
  };

  const CounsellorRoute = ({ children }) => {
    return user && user.role === "counsellor" ? children : <Navigate to="/" />;
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
      {user && (
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
                    <button onClick={() => setShowPhq9(true)} className="hover:text-blue-500 cursor-pointer transition text-left">
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
                onClick={handleLogout}
                className="px-4 py-1 rounded bg-red-50 text-red-600 font-semibold hover:bg-red-100 hover:underline transition"
              >
                Logout
              </button>
            </div>
          </div>
        </header>
      )}

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
              user ? (
                user.role === "counsellor" ? (
                  <Navigate to="/CounsellorDashboard" />
                ) : (
                  <Navigate to="/chatbot" />
                )
              ) : (
                <AuthPage />
              )
            }
          />
          <Route path="/login" element={<AuthPage />} />

          {/* Protected Pages */}
          <Route
            path="/chatbot"
            element={
              <PrivateRoute>
                <Chatbot />
              </PrivateRoute>
            }
          />
          <Route
            path="/peer-to-peer"
            element={
              <PrivateRoute>
                <PeerToPeer />
              </PrivateRoute>
            }
          />
          <Route
            path="/screening"
            element={
              <PrivateRoute>
                <Screening />
              </PrivateRoute>
            }
          />
          <Route
            path="/booking"
            element={
              <PrivateRoute>
                <Booking counsellors={counsellors} />
              </PrivateRoute>
            }
          />
          <Route
            path="/forum"
            element={
              <PrivateRoute>
                <Forum />
              </PrivateRoute>
            }
          />
          <Route
            path="/resources"
            element={
              <PrivateRoute>
                <Resources />
              </PrivateRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <PrivateRoute>
                <Admin />
              </PrivateRoute>
            }
          />

          {/* Counsellor-only route */}
          <Route
            path="/CounsellorDashboard"
            element={
              <CounsellorRoute>
                <CounsellorDashboard />
              </CounsellorRoute>
            }
          />
        </Routes>

        {/* Counsellors List */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-6">
          {counsellors.map((c) => (
            <div
              key={c.id}
              className="bg-white shadow rounded-lg p-6 flex flex-col items-center"
            >
              <div className="text-xl font-bold text-blue-700 mb-2">{c.name}</div>
              <div className="text-gray-700 mb-1">{c.specialization}</div>
              <div className="text-sm text-gray-500 mb-2">{c.email}</div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}

export default App;