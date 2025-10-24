import React, { useState, useEffect } from "react";
import { loginUser, registerUser, logoutUser, signInWithGoogle } from "../services/auth";
import { db } from "../firebase";
import { collection, query as q, where, getDocs } from "firebase/firestore";
import { Link } from 'react-router-dom';
import { toast } from "react-toastify";
import bgVideo from "../assets/Login.mp4";
import logo from "../assets/mindsphere-logo.png";
import LogoLoader from "../components/LogoLoader";
import { useLocation } from "react-router-dom";

// Accept an optional prop to default the role selector
const AuthPage = ({ defaultRole } = {}) => {
  const [isLogin, setIsLogin] = useState(true);
  const [role, setRole] = useState(defaultRole ?? "user");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [specialization, setSpecialization] = useState("");
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // routing happens centrally in App.jsx once authoritative auth state arrives
  const location = useLocation();
  const [videoLoaded, setVideoLoaded] = useState(false);

  // Notify App that this page is ready when not performing auth actions (no blocking init)
  useEffect(() => {
    if (!isLoading) {
      try { window.dispatchEvent(new CustomEvent('mindsphere:pageReady')); } catch(e) {}
    }
  }, [isLoading]);

  // Initialize role from defaultRole prop or ?role=... query param.
  // Run only when defaultRole or the query string changes; do NOT include `role` so
  // user clicks on the role buttons are not overwritten.
  useEffect(() => {
    if (typeof defaultRole !== 'undefined') {
      setRole(defaultRole);
      return;
    }
    try {
      const params = new URLSearchParams(location.search);
      const queryRole = params.get('role');
      if (queryRole) setRole(queryRole);
    } catch {
      // ignore malformed query
    }
  }, [defaultRole, location.search]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    const start = Date.now();
    try {
      const result = await loginUser(email, password);

      // Determine the authoritative role: prefer the role returned by the auth call,
      // fall back to the UI-selected role if none was returned.
      const acctRole = result && result.role ? result.role : role;

      // Set firstLogin flag when applicable (keep previous behaviour for users)
      if (result && result.firstLogin && acctRole === 'user') {
        try {
          sessionStorage.setItem('firstLogin', '1');
        } catch (storageErr) {
          console.warn('sessionStorage set failed', storageErr);
        }
      }

      // Immediately navigate based on authoritative role
      // Persist role briefly so the header can render correct nav while Firebase finishes
      try { sessionStorage.setItem('authRole', acctRole); } catch(e) { /* ignore */ }

      // Persist role briefly so the header can render correct nav while Firebase finishes
      // The authoritative navigation will be performed by App when the user object arrives.
      try { sessionStorage.setItem('authRole', acctRole); } catch(e) { /* ignore */ }
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 2000) await new Promise((r) => setTimeout(r, 2000 - elapsed));
      setIsLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    const start = Date.now();
    try {
      const result = await registerUser(email, password, role, role === "counsellor" ? { name, specialization } : { name });
      
      // Show success toast
      toast.success(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">🎉 Account Created!</div>
          <div className="text-sm mt-1">
            Welcome to MindSphere, <span className="font-medium">{name}</span>! Your {role} account has been created successfully.
          </div>
        </div>,
        {
          position: "top-right",
          autoClose: 4000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          className: "custom-success-toast",
        }
      );
      
      // Set firstLogin flag for users
      if (role === 'user') {
        try {
          sessionStorage.setItem('firstLogin', '1');
        } catch (storageErr) {
          console.warn('sessionStorage set failed', storageErr);
        }
      }
      
      // Navigate based on role - REMOVE setIsLogin(true) and ADD navigation
      // Persist role briefly so the header can render correct nav while Firebase finishes
      try { sessionStorage.setItem('authRole', role); } catch(e) { /* ignore */ }
      // Persist role briefly so header can render correctly. App will route on auth change.
      try { sessionStorage.setItem('authRole', role); } catch(e) { /* ignore */ }
    } catch (err) {
      setError(err.message || "Signup failed");

      // Show error toast
      toast.error(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">❌ Signup Failed</div>
          <div className="text-sm mt-1">
            {err.message || "Something went wrong during signup. Please try again."}
          </div>
        </div>,
        {
          position: "top-right",
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          className: "custom-error-toast",
        }
      );
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 2000) await new Promise((r) => setTimeout(r, 2000 - elapsed));
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setIsLoading(true);
    const start = Date.now();
    try {
      // Force Google sign-in to always be for users only
      const result = await signInWithGoogle('user');
      
      // Show success toast
      toast.success(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">🎉 Welcome to MindSphere!</div>
          <div className="text-sm mt-1">
            Successfully signed in with Google as <span className="font-medium">user</span>
          </div>
        </div>,
        {
          position: "top-right",
          autoClose: 4000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          className: "custom-success-toast",
        }
      );
      
      // Set firstLogin flag if applicable
      if (result && result.firstLogin) {
        try { sessionStorage.setItem('firstLogin', '1'); } catch(e) { /* ignore */ }
      }

      // Navigate based on role returned by signInWithGoogle (usually 'user')
      const gRole = result && result.role ? result.role : 'user';
  try { sessionStorage.setItem('authRole', gRole); } catch(e) { /* ignore */ }
  // App will perform the authoritative navigation after Firebase auth settles.
    } catch (err) {
      setError(err.message || "Google sign-in failed");

      // Show error toast
      toast.error(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">❌ Sign-in Failed</div>
          <div className="text-sm mt-1">
            {err.message || "Google sign-in failed. Please try again."}
          </div>
        </div>,
        {
          position: "top-right",
          autoClose: 5000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          className: "custom-error-toast",
        }
      );
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 2000) await new Promise((r) => setTimeout(r, 2000 - elapsed));
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-black px-4 overflow-hidden">
      {/* Background video - fixed to viewport and covers entire page */}
      <video
        className={`fixed inset-0 w-full h-full object-cover pointer-events-none z-0 transition-opacity duration-700 ${videoLoaded ? 'opacity-100' : 'opacity-0'}`}
        src={bgVideo}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster={logo}
        onLoadedData={() => setVideoLoaded(true)}
        onCanPlay={() => setVideoLoaded(true)}
        aria-hidden="true"
      />
      {/* Subtle overlay to improve contrast */}
      <div className="fixed inset-0 bg-black/30 pointer-events-none z-5" />

  <div className="relative z-10 bg-white/70 shadow-xl rounded-2xl overflow-hidden w-full max-w-4xl md:max-w-6xl grid grid-cols-1 md:grid-cols-2">
        {/* Left panel - simple illustration and brand */}
          <div className="hidden md:flex flex-col items-center justify-center p-6 bg-gradient-to-b from-white to-gray-50">
          <div className="w-40 h-40 md:w-52 md:h-52 rounded-xl bg-white flex items-center justify-center shadow-md">
            {/* MindSphere logo - set stable size and eager load to avoid layout jitter */}
            <img src={logo} alt="MindSphere Logo" className="w-32 h-32 md:w-44 md:h-44 object-contain" width="176" height="176" loading="eager" />
          </div>
          <h3 className="mt-6 text-3xl font-semibold text-[#263238]">MindSphere</h3>
          <p className="mt-4 text-base text-[#90A4AE] text-center px-8">Confidential, simple, and supportive mental health tools for students.</p>
        </div>

        {/* Right panel - form */}
  <div className="relative px-6 py-8 md:p-16">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl md:text-3xl font-bold text-[#263238]">{isLogin ? "Welcome back" : "Create Account"}</h2>
            <div className="text-sm text-[#263238]">{isLogin ? "New here?" : "Already registered?"} <button disabled={isLoading} type="button" onClick={() => { setError(""); setIsLogin(!isLogin); }} className="ml-2 px-3 py-1 rounded-md text-black font-medium cursor-pointer border border-black hover:bg-[#FF8C42] hover:text-white transition focus:outline-none focus:ring-4 focus:ring-[#FF8C42]/30 disabled:opacity-60">{isLogin ? "Sign up" : "Login"}</button></div>
          </div>


          <p className="mt-3 text-base text-[#263238]">{isLogin ? "Sign in to continue to MindSphere" : "A short signup to get started"}</p>

          {/* Role toggle */}
          <div className="mt-6">
            <div className="flex items-center space-x-2">
              <button disabled={isLoading} type="button" onClick={() => setRole('user')} className={`px-4 py-2 rounded-full text-base font-medium cursor-pointer text-[#263238] ${role === 'user' ? 'bg-white/60 text-[#263238]' : 'text-[#90A4AE] hover:text-[#263238]'} disabled:opacity-60`}>User</button>
              <button disabled={isLoading} type="button" onClick={() => setRole('counsellor')} className={`px-4 py-2 rounded-full text-base font-medium cursor-pointer text-[#263238] ${role === 'counsellor' ? 'bg-white/60 text-[#263238]' : 'text-[#90A4AE] hover:text-[#263238]'} disabled:opacity-60`}>Counsellor</button>
              {/* Only show admin toggle when explicitly requested via defaultRole or when user chooses it */}
              <button disabled={isLoading} type="button" onClick={() => setRole('admin')} className={`px-4 py-2 rounded-full text-base font-medium cursor-pointer text-[#263238] ${role === 'admin' ? 'bg-white/60 text-[#263238]' : 'text-[#90A4AE] hover:text-[#263238]'} disabled:opacity-60`}>Admin</button>
            </div>
          </div>

          <form onSubmit={isLogin ? handleLogin : handleSignup} className="mt-6 space-y-4">
            {!isLogin && role === 'counsellor' && (
              <>
                <div>
                  <label className="block text-base font-semibold text-[#263238] mb-1">Full name</label>
                  <input disabled={isLoading} value={name} onChange={(e) => setName(e.target.value)} className="w-full px-5 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] focus:border-[#FF8C42] text-base" placeholder="Jane Doe" required />
                </div>
                <div>
                  <label className="block text-base font-semibold text-[#263238] mb-1">Specialization</label>
                  <input disabled={isLoading} value={specialization} onChange={(e) => setSpecialization(e.target.value)} className="w-full px-5 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] focus:border-[#FF8C42] text-base" placeholder="e.g. Child Psychologist" required />
                </div>
              </>
            )}

            {!isLogin && role === 'user' && (
                <div>
                <label className="block text-base font-semibold text-[#263238] mb-1">Full name</label>
                <input disabled={isLoading} value={name} onChange={(e) => setName(e.target.value)} className="w-full px-5 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] focus:border-[#FF8C42] text-base" placeholder="John Doe" required />
              </div>
            )}

            <div>
              <label className="block font-semibold text-base text-[#263238] mb-1">Email</label>
              <input disabled={isLoading} type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full  px-5 py-3  border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#263238] hover:border-[#FF8C42] text-base" placeholder="you@school.edu" required />
            </div>

            <div>
              <label className="block font-semibold text-base text-[#263238] mb-1">Password</label>
              <div className="relative">
                <input disabled={isLoading} type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} className="w-full px-5 py-3 border border-gray-200 hover:border-[#FF8C42] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] pr-12 text-base" placeholder="Enter password" required />
                <button disabled={isLoading} type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm md:text-base text-[#263238] cursor-pointer hover:text-[#e6732f]">{showPassword ? 'Hide' : 'Show'}</button>
              </div>
            </div>

            {error && <div className="text-base text-red-500">{error}</div>}

            <button disabled={isLoading} type="submit" className="w-full py-3 bg-[#FF8C42] disabled:opacity-70 text-white rounded-lg font-semibold shadow-sm hover:bg-[#e6732f] focus:outline-none focus:ring-4 focus:ring-[#FF8C42]/30 transition cursor-pointer text-lg flex items-center justify-center space-x-3">
              {isLoading ? (
                <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
              ) : null}
              <span>{isLogin ? 'Sign in' : 'Create account'}</span>
            </button>
            
            {/* Info message for counsellors */}
            {/* {isLogin && role === 'counsellor' && (
              <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  <span className="font-medium">Note:</span> Counsellors must use email and password to sign in. Google sign-in is only available for users.
                </p>
              </div>
            )} */}
          </form>

          {/* Google Sign In Button - Only show for users during login */}
          {isLogin && role === 'user' && (
            <>
              {/* Divider */}
              <div className="mt-6 flex items-center">
                <div className="flex-1 border-t border-gray-300"></div>
                <span className="px-4 text-sm text-[#90A4AE]">or</span>
                <div className="flex-1 border-t border-gray-300"></div>
              </div>

              {/* Google Sign In Button */}
              <button
                type="button"
                disabled={isLoading}
                onClick={handleGoogleSignIn}
                className="w-full mt-4 py-3 bg-white border border-gray-300 rounded-lg font-semibold shadow-sm hover:bg-gray-50 focus:outline-none focus:ring-4 focus:ring-gray-200 transition cursor-pointer text-lg flex items-center justify-center space-x-3 disabled:opacity-70"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                <span className="text-[#263238]">Continue with Google</span>
              </button>
              {/* Back to home link placed below Google button */}
            </>
          )}
              <div className="mt-3 text-center">
                <Link to="/landing" className="text-sm text-[#263238]">Back to home</Link>
              </div>
        </div>
      </div>
      {/* Full-page loader overlay to avoid any UI glitches during auth */}
  {/* Use a subtle, non-blocking overlay so navigation feels instant and avoids perceived glitches */}
  <LogoLoader active={isLoading} minDuration={2000} size={128} text={"Preparing your dashboard…"} overlay overlayOpacity={0.92} blockInteraction={false} />
    </div>
  );
};

export default AuthPage;