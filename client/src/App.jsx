import { Routes, Route, Navigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import LandingPage from "./pages/LandingPage"; // Import the new landing page
import AuthPage from "./pages/Authentication";
import Chatbot from "./pages/Chatbot";
import Booking from "./pages/Booking";
import Resources from "./pages/Resources";
import AdminDashboard from "./pages/AdminDashboard";
import PeerToPeer from "./pages/Peer-to-Peer";
import CounsellorDashboard from "./pages/CounsellorDashboard";
import Profile from "./pages/Profile";
import CounsellorProfile from "./pages/CounsellorProfile";
import { onAuthChange, logoutUser } from "./services/auth";
import PHQ9Modal from "./components/PHQ9Modal";
import { API } from "./hooks/helper";
import Layout from "./components/Layout";
import { PrivateRoute, CounsellorRoute, AdminRoute } from "./components/ProtectedRoutes";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [initialAuthChecked, setInitialAuthChecked] = useState(false);
  const [counsellors, _setCounsellors] = useState([]);
  const [showPhq9, setShowPhq9] = useState(false);
  const [phq9Checked, setPhq9Checked] = useState(false);
  const [firstLoginCandidate, setFirstLoginCandidate] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthChange((currentUser) => {
      setUser(currentUser);
      setLoading(false);
      setInitialAuthChecked(true);
      if (currentUser) {
        if (currentUser.signedUp && currentUser.role === "user") {
          const isFirstLogin = !!sessionStorage.getItem("firstLogin");
          setFirstLoginCandidate(isFirstLogin);
          setPhq9Checked(false);
          setShowPhq9(false);
        } else {
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

  useEffect(() => {
    const checkPhq9 = async () => {
      if (!user || phq9Checked || user.role !== "user" || !firstLoginCandidate)
        return;
      try {
        const base = API;
        const url = `${base.replace(/\/$/, "")}/api/phq9/${encodeURIComponent(user.email)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error("phq9 fetch failed");
        const data = await res.json();
        if (data && data.timestamp) {
          const ts = new Date(data.timestamp);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          if (ts < sevenDaysAgo) {
            setShowPhq9(true);
          }
        } else {
          setShowPhq9(true);
        }
      } catch (e) {
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

  if (loading && !initialAuthChecked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50">
        <div className="text-center">
          <img src="/mindsphere-logo.png" alt="Loading..." className="animate-pulse h-24 w-24 mx-auto" />
        </div>
      </div>
    );
  }

  // This component will render the main app layout for authenticated users
  const AuthenticatedLayout = () => (
    <Layout user={user} onLogout={handleLogout} onShowPhq9={() => setShowPhq9(true)}>
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
          path="/profile"
          element={
            <PrivateRoute user={user}>
              <Profile />
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

        <Route
          path="/CounsellorProfile"
          element={
            <CounsellorRoute user={user}>
              <CounsellorProfile />
            </CounsellorRoute>
          }
        />
      </Routes>
    </Layout>
  );

  // This component will render routes for unauthenticated users
  const UnauthenticatedLayout = () => (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<AuthPage />} />
      {/* Redirect any other route to the landing page */}
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );

  return (
    <>
      {user ? <AuthenticatedLayout /> : <UnauthenticatedLayout />}
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
