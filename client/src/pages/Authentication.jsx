import React, { useState } from "react";
import { loginUser, registerUser, logoutUser } from "../services/auth";
import { db } from "../firebase";
import { collection, query as q, where, getDocs } from "firebase/firestore";
import { useNavigate } from 'react-router-dom';
import bgVideo from "../assets/Login.mp4";
import logo from "../assets/mindsphere-logo.png";

const AuthPage = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [role, setRole] = useState("user");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      // Pre-check: try to find a users doc for this email to validate role before signing in.
      // This avoids signing in then immediately signing out when roles don't match.
      if (role) {
        try {
          const usersRef = collection(db, 'users');
          const qq = q(usersRef, where('email', '==', email));
          const snap = await getDocs(qq);
          if (!snap.empty) {
            // Use the first matched document
            const data = snap.docs[0].data();
            const foundRole = data.role;
            if (foundRole && foundRole !== role) {
              setError(`This email is registered as '${foundRole}'. Please sign in as '${foundRole}' or sign up as a '${role}'.`);
              return;
            }
          } else {
            // No users doc found: require signup first
            setError(`No account found for this email. Please sign up as a ${role} first.`);
            return;
          }
        } catch (preErr) {
          // If Firestore lookup fails (security rules or network), fall back to sign-in and server-side check
          console.warn('Pre-check failed, falling back to sign-in flow', preErr);
        }
      }
      const result = await loginUser(email, password);
      // Validate that the signed-in account matches the selected role
      const signedUp = result && result.signedUp;
      const acctRole = result && result.role;
      if (!signedUp || acctRole !== role) {
        // Sign them out immediately and show guidance
        try { await logoutUser(); } catch (_) {}
        // Friendly message depending on mismatch
        if (!signedUp) {
          setError(`This account has not completed signup. Please sign up as a ${role} first.`);
        } else {
          setError(`This account is registered as '${acctRole}'. Please sign in using the '${acctRole}' role or sign up as a '${role}'.`);
        }
        return;
      }
      // Successful login - set firstLogin flag if applicable
      if (result && result.firstLogin && role === 'user') {
        try { sessionStorage.setItem('firstLogin', '1'); } catch(e) { /* ignore */ }
      }
      // Navigate to root which will redirect based on role
      navigate('/');
    } catch (err) {
      setError(err.message || "Login failed");
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    try {
      await registerUser(email, password, role, role === "counsellor" ? { name, specialization } : {});
      setIsLogin(true);
    } catch (err) {
      setError(err.message || "Signup failed");
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-black px-4 overflow-hidden">
      {/* Background video - fixed to viewport and covers entire page */}
      <video
        className="fixed inset-0 w-full h-full object-cover pointer-events-none z-0"
        src={bgVideo}
        autoPlay
        muted
        loop
        playsInline
        poster={logo}
      />
      {/* Subtle overlay to improve contrast */}
      <div className="fixed inset-0 bg-black/30 pointer-events-none z-5" />

  <div className="relative z-10 bg-white/70 shadow-xl rounded-2xl overflow-hidden w-full max-w-6xl grid grid-cols-1 md:grid-cols-2">
        {/* Left panel - simple illustration and brand */}
          <div className="hidden md:flex flex-col items-center justify-center p-2 bg-gradient-to-b from-white to-gray-50">
          <div className="w-52 h-52 rounded-xl bg-white flex items-center justify-center shadow-md">
            {/* MindSphere logo */}
            <img src={logo} alt="MindSphere Logo" className="w-50 h-50 object-contain" />
          </div>
          <h3 className="mt-6 text-3xl font-semibold text-[#263238]">MindSphere</h3>
          <p className="mt-4 text-base text-[#90A4AE] text-center px-8">Confidential, simple, and supportive mental health tools for students.</p>
        </div>

        {/* Right panel - form */}
        <div className="p-10 md:p-16">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl md:text-3xl font-bold text-[#263238]">{isLogin ? "Welcome back" : "Create Account"}</h2>
            <div className="text-sm text-[#263238]">{isLogin ? "New here?" : "Already registered?"} <button type="button" onClick={() => { setError(""); setIsLogin(!isLogin); }} className="ml-2 px-3 py-1 rounded-md text-black font-medium cursor-pointer border-1 border-black hover:bg-[#FF8C42] hover:text-white transition focus:outline-none focus:ring-4 focus:ring-[#FF8C42]/30">{isLogin ? "Sign up" : "Login"}</button></div>
          </div>

          <p className="mt-3 text-base text-[#263238]">{isLogin ? "Sign in to continue to MindSphere" : "A short signup to get started"}</p>

          {/* Role toggle */}
          <div className="mt-6">
            <div className="flex items-center space-x-2">
              <button type="button" onClick={() => setRole('user')} className={`px-4 py-2 rounded-full text-base font-medium cursor-pointer text-[#263238] ${role === 'user' ? 'bg-white/60 text-[#263238]' : 'text-[#90A4AE] hover:text-[#263238]'}`}>User</button>
              <button type="button" onClick={() => setRole('counsellor')} className={`px-4 py-2 rounded-full text-base font-medium cursor-pointer text-[#263238] ${role === 'counsellor' ? 'bg-white/60 text-[#263238]' : 'text-[#90A4AE] hover:text-[#263238]'}`}>Counsellor</button>
            </div>
          </div>

          <form onSubmit={isLogin ? handleLogin : handleSignup} className="mt-6 space-y-4">
            {!isLogin && role === 'counsellor' && (
              <>
                <div>
                  <label className="block text-base font-semibold text-[#263238] mb-1">Full name</label>
                  <input value={name} onChange={(e) => setName(e.target.value)} className="w-full px-5 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] focus:border-[#FF8C42] text-base" placeholder="Jane Doe" required />
                </div>
                <div>
                  <label className="block text-base font-semibold text-[#263238] mb-1">Specialization</label>
                  <input value={specialization} onChange={(e) => setSpecialization(e.target.value)} className="w-full px-5 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] focus:border-[#FF8C42] text-base" placeholder="e.g. Child Psychologist" required />
                </div>
              </>
            )}

            <div>
              <label className="block font-semibold text-base text-[#263238] mb-1">Email</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full  px-5 py-3  border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#263238] hover:border-[#FF8C42] text-base" placeholder="you@school.edu" required />
            </div>

            <div>
              <label className="block font-semibold text-base text-[#263238] mb-1">Password</label>
              <div className="relative">
                <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-5 py-3 border border-gray-200 hover:border-[#FF8C42] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] pr-12 text-base" placeholder="Enter password" required />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm md:text-base text-[#263238] cursor-pointer hover:text-[#e6732f]">{showPassword ? 'Hide' : 'Show'}</button>
              </div>
            </div>

            {error && <div className="text-base text-red-500">{error}</div>}

            <button type="submit" className="w-full py-3 bg-[#FF8C42] text-white rounded-lg font-semibold shadow-sm hover:bg-[#e6732f] focus:outline-none focus:ring-4 focus:ring-[#FF8C42]/30 transition cursor-pointer text-lg">{isLogin ? 'Sign in' : 'Create account'}</button>
          </form>

          <div className="mt-6 text-center text-sm text-cc-text-muted">
            By continuing, you agree to our <a className="text-cc-text-dark underline">Terms</a> and <a className="text-cc-text-dark underline">Privacy Policy</a>.
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuthPage;