import { Routes, Route, Link } from "react-router-dom";
import Chatbot from "./pages/Chatbot";
import Screening from "./pages/Screening";
import Booking from "./pages/Booking";
import Forum from "./pages/Forum";
import Resources from "./pages/Resources";
import Admin from "./pages/Admin";

function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="bg-white shadow">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">MindSphere (Prototype)</h1>
          <nav className="space-x-4">
            <Link to="/" className="text-sm text-blue-600">Chat</Link>
            <Link to="/screening" className="text-sm text-blue-600">Screening</Link>
            <Link to="/booking" className="text-sm text-blue-600">Booking</Link>
            <Link to="/forum" className="text-sm text-blue-600">Forum</Link>
            <Link to="/resources" className="text-sm text-blue-600">Resources</Link>
            <Link to="/admin" className="text-sm text-blue-600">Admin</Link>
          </nav>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4">
        <Routes>
          <Route path="/" element={<Chatbot />} />
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
