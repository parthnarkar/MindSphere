import { BrowserRouter, Routes, Route, Navigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import AuthPage from "./pages/login";
import Chatbot from "./pages/Chatbot";
import Screening from "./pages/Screening";
import Booking from "./pages/Booking";
import Forum from "./pages/Forum";
import Resources from "./pages/Resources";
import Admin from "./pages/Admin";
import { onAuthChange, logoutUser } from "./services/auth"; // Import your logout function
import PeerToPeer from "./pages/Peer-to-Peer";

function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthChange((currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    await logoutUser();
    setUser(null);
  };

  const PrivateRoute = ({ children }) => {
    return user ? children : <Navigate to="/" />;
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header only visible when user is logged in */}
      {user && (
        <header className="bg-white shadow p-4 mb-4">
          <nav className="space-x-4">
            <Link to="/chatbot">Chat</Link>
            <Link to="/screening">Screening</Link>
            <Link to="/booking">Booking</Link>
            <Link to="/forum">Forum</Link>
            <Link to="/resources">Resources</Link>
            <Link to="/admin">Admin</Link>
            <button onClick={handleLogout} className="ml-4 text-red-600">Logout</button>
            <Link to="/" className="text-sm text-blue-600">Chat</Link>
            <Link to="/peer-to-peer" className="text-sm text-blue-600">Peer-to-Peer Conversation</Link>
            <Link to="/screening" className="text-sm text-blue-600">Screening</Link>
            <Link to="/booking" className="text-sm text-blue-600">Booking</Link>
            <Link to="/forum" className="text-sm text-blue-600">Forum</Link>
            <Link to="/resources" className="text-sm text-blue-600">Resources</Link>
            <Link to="/admin" className="text-sm text-blue-600">Admin</Link>
          </nav>
        </header>
      )}
      <main className="max-w-4xl mx-auto p-4">
        <Routes>
          {/* Login/signup page */}
          <Route path="/" element={user ? <Navigate to="/chatbot" /> : <AuthPage />} />
          <Route path="/login" element={<AuthPage />} /> {/* <-- Add this line */}

          {/* Protected pages */}
          <Route path="/chatbot" element={<PrivateRoute><Chatbot /></PrivateRoute>} />
          <Route path="/screening" element={<PrivateRoute><Screening /></PrivateRoute>} />
          <Route path="/booking" element={<PrivateRoute><Booking /></PrivateRoute>} />
          <Route path="/forum" element={<PrivateRoute><Forum /></PrivateRoute>} />
          <Route path="/resources" element={<PrivateRoute><Resources /></PrivateRoute>} />
          <Route path="/admin" element={<PrivateRoute><Admin /></PrivateRoute>} />
          <Route path="/" element={<Chatbot />} />
          <Route path="/peer-to-peer" element={<PeerToPeer />} />
          <Route path="/screening" element={<Screening />} />
          <Route path="/booking" element={<Booking />} />
          <Route path="/forum" element={<Forum />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/admin" element={<Admin />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
