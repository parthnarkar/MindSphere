import React, { useState, useEffect, useRef } from "react";
import {
  loginUser,
  registerUser,
  signInWithGoogle,
  logoutUser,
  getRoleByEmail,
} from "../services/auth";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import bgVideo from "../assets/Login.mp4";
import logo from "../assets/mindsphere-logo.png";
import { useLocation } from "react-router-dom";
import fallback from "../assets/fallback-auth-bg.png";
import { API } from "../hooks/helper";

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
  const [roleMismatchDialogOpen, setRoleMismatchDialogOpen] = useState(false);
  const [roleMismatchData, setRoleMismatchData] = useState(null);
  const [adminCreds, setAdminCreds] = useState(null);
  const [changePopupOpen, setChangePopupOpen] = useState(false);
  const [oldAdminUsername, setOldAdminUsername] = useState("");
  const [oldAdminPassword, setOldAdminPassword] = useState("");
  const [newAdminUsername, setNewAdminUsername] = useState("");
  const [newAdminPassword, setNewAdminPassword] = useState("");
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState("");
  // routing happens centrally in App.jsx once authoritative auth state arrives
  const location = useLocation();
  const [videoLoaded, setVideoLoaded] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [videoRetry, setVideoRetry] = useState(0);
  const videoRef = useRef(null);
  const navigate = useNavigate();
  const mainRef = useRef(null);

  // Shared UI classes
  const btnBase = "px-4 py-2 rounded-md text-sm font-medium";
  const btnPrimary = `${btnBase} bg-[#FF8C42] text-white hover:bg-[#e6732f] shadow-sm`;
  const btnSecondary = `${btnBase} bg-white text-[#263238] border border-gray-200 hover:bg-gray-50`;
  const roleToggle =
    "px-4 py-2 rounded-full text-base font-medium cursor-pointer";

  // Notify App that this page is ready when not performing auth actions (no blocking init)
  useEffect(() => {
    if (!isLoading) {
      try {
        window.dispatchEvent(new CustomEvent("mindsphere:pageReady"));
      } catch (e) {}
    }
  }, [isLoading]);

  // Fetch admin credentials from server on mount and log them (debugging)
  useEffect(() => {
    const fetchAdmin = async () => {
      try {
        const resp = await fetch(`${API}/api/admin/login`);
        const contentType = (
          resp.headers.get("content-type") || ""
        ).toLowerCase();

        if (!resp.ok) {
          // Try to extract a helpful body for debugging
          let bodyText = "";
          try {
            if (contentType.includes("application/json")) {
              const errJson = await resp.json();
              bodyText = JSON.stringify(errJson);
            } else {
              bodyText = await resp.text();
            }
          } catch (e) {
            bodyText = `<unreadable response: ${e.message}>`;
          }
          console.warn(
            "admin login returned non-OK status",
            resp.status,
            bodyText
          );
          setAdminCreds(null);
          return;
        }

        // Only parse JSON responses; guard against HTML (e.g. dev-server index.html)
        if (contentType.includes("application/json")) {
          const data = await resp.json().catch(() => ({}));
          // Server may return one of several shapes for debugging:
          // - an array: [ { email, id, password } ]
          // - a minimal object: { email, id, password }
          // - legacy wrapper: { admin: { ... } }
          let admin = null;
          if (Array.isArray(data) && data.length > 0) {
            admin = data[0];
          } else if (data && data.admin) {
            admin = data.admin;
          } else if (data && data.email) {
            admin = data;
          }
          setAdminCreds(admin);
        } else {
          // Likely the dev server served index.html (HTML) because the backend
          // either isn't running or the proxy is not configured. Log the body to help debug.
          const text = await resp.text().catch(() => "<unreadable body>");
          console.warn(
            "admin login returned non-JSON response (likely HTML).",
            {
              status: resp.status,
              contentType,
              bodyPreview: (text || "").slice(0, 1000),
            }
          );
          setAdminCreds(null);
        }
      } catch (err) {
        console.error("admin login fetch failed", err);
      }
    };
    fetchAdmin();
  }, []);

  // helper: persist a short-lived authRole for header rendering
  function persistAuthRole(r) {
    try {
      sessionStorage.setItem("authRole", r);
    } catch (e) {
      /* ignore */
    }
  }

  function showChangePopup() {
    // Open the change-credentials popup/modal
    setChangeError("");
    setOldAdminUsername("");
    setOldAdminPassword("");
    setNewAdminUsername("");
    setNewAdminPassword("");
    setChangePopupOpen(true);
  }

  // Prevent background scrolling when modal is open
  useEffect(() => {
    try {
      if (changePopupOpen || roleMismatchDialogOpen) {
        document.body.style.overflow = "hidden";
      } else {
        document.body.style.overflow = "";
      }
    } catch (e) {}
    return () => {
      try {
        document.body.style.overflow = "";
      } catch (e) {}
    };
  }, [changePopupOpen, roleMismatchDialogOpen]);

  // Submit handler for changing admin credentials
  const handleChangeCredentials = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setChangeError("");

    // Basic validation
    if (!oldAdminUsername || !oldAdminPassword) {
      setChangeError("Please enter current username and password");
      return;
    }
    if (!newAdminUsername || !newAdminPassword) {
      setChangeError("Please enter new username and password");
      return;
    }

    // If we have fetched admin creds, verify the old ones match first
    const hasLocalAdmin = adminCreds && adminCreds.email;
    const oldUserNormalized = String(oldAdminUsername || "").trim().toLowerCase();
    const storedUserNormalized = hasLocalAdmin
      ? String(adminCreds.email || "").trim().toLowerCase()
      : null;
    const oldPass = String(oldAdminPassword || "");

    if (hasLocalAdmin && (oldUserNormalized !== storedUserNormalized || oldPass !== String(adminCreds.password || ""))) {
      setChangeError("Current admin mail and password is incorrect");
      return;
    }

    setChangeLoading(true);
    try {
      // Try to update server-side if an endpoint exists. This is best-effort.
      let serverUpdated = false;
      try {
        // Call the new server-side PUT handler to update admin creds in MongoDB
        const resp = await fetch(`${API}/api/admin/login`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oldEmail: oldAdminUsername,
            oldPassword: oldAdminPassword,
            newEmail: newAdminUsername,
            newPassword: newAdminPassword,
          }),
        });

        const data = await resp.json().catch(() => null);
        if (resp.ok && data) {
          // Server returns an array [ minimal ] — normalise to single object
          let updated = null;
          if (Array.isArray(data) && data.length > 0) updated = data[0];
          else if (data && data.email) updated = data;
          else if (data && data.admin) updated = data.admin;

          if (updated) {
            setAdminCreds(updated);
          } else {
            // If response shape unexpected, still update local copy so UI continues to work
            setAdminCreds((prev) => ({ ...(prev || {}), email: newAdminUsername, password: newAdminPassword }));
          }
          serverUpdated = true;
        } else {
          // Server returned non-OK; surface server message when available
          const msg = (data && (data.error || data.details)) || `Server update failed (${resp.status})`;
          console.warn("admin update server returned non-ok", resp.status, msg);
          setChangeError(msg);
          serverUpdated = false;
        }
      } catch (srvErr) {
        console.warn("admin update server call failed", srvErr);
        serverUpdated = false;
      }

      if (!serverUpdated) {
        // perform local update if old creds matched earlier
        setAdminCreds((prev) => ({ ...(prev || {}), email: newAdminUsername, password: newAdminPassword }));
        toast.success("Admin credentials updated locally");
      } else {
        toast.success("Admin credentials updated");
      }

      setChangePopupOpen(false);
    } catch (err) {
      console.error("change admin credentials failed", err);
      setChangeError("Failed to change admin credentials");
    } finally {
      setChangeLoading(false);
    }
  };

  // Initialize role from defaultRole prop or ?role=... query param.
  // Run only when defaultRole or the query string changes; do NOT include `role` so
  // user clicks on the role buttons are not overwritten.
  useEffect(() => {
    if (typeof defaultRole !== "undefined") {
      setRole(defaultRole);
      return;
    }
    try {
      const params = new URLSearchParams(location.search);
      const queryRole = params.get("role");
      if (queryRole) setRole(queryRole);
    } catch {
      // ignore malformed query
    }
  }, [defaultRole, location.search]);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");

    // Pre-check: lookup the registered role (if any) for this email and
    // short-circuit the sign-in if the registered role doesn't match the
    // UI-selected role. Show a dialog immediately so the user can choose a
    // corrective action instead of entering a loading state.
    try {
      if (!email || !email.trim()) {
        setError("Please enter an email");
        return;
      }
      const lookup = await getRoleByEmail(email.trim());
      if (lookup && lookup.exists && lookup.role && lookup.role !== role) {
        setRoleMismatchData({ registeredRole: lookup.role, email });
        setRoleMismatchDialogOpen(true);
        return;
      }
    } catch (lookupErr) {
      // Don't block the login flow on transient lookup failures.
      console.warn("role lookup failed, continuing to login", lookupErr);
    }

    // If admin role selected, match input against fetched adminCreds (client-side check)
    if (role === "admin") {
      setIsLoading(true);
      try {
        // If we fetched admin credentials on mount, use them for a quick client-side match
        if (adminCreds && adminCreds.email) {
          // Ensure we're comparing strings (defensive) and normalise casing for emails
          const inputEmail = String(email || "")
            .trim()
            .toLowerCase();
          const storedEmail = String(adminCreds.email || "")
            .trim()
            .toLowerCase();
          const inputPassword = String(password || "");
          const storedPassword = String(adminCreds.password || "");
          if (inputEmail === storedEmail && inputPassword === storedPassword) {
            // Successful local match
            persistAuthRole("admin");
            try {
              navigate("/admin-dashboard");
            } catch (e) {
              // show message invalid admin credentials
              setError("Invalid admin credentials");
            }
            return;
          }

          // Local creds exist but didn't match -> invalid credentials
          setError("Invalid admin credentials");
          setIsLoading(false);
          return;
        }

        // Fallback: if we don't have fetched creds, call the server endpoint as before
        const resp = await fetch(`/api/admin/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email.trim(), password }),
        });
        const data = await resp.json().catch(() => ({}));
        // Normalize response shapes: array -> first element, legacy wrapper, or minimal object
        let adminResp = null;
        if (Array.isArray(data) && data.length > 0) {
          adminResp = data[0];
        } else if (data && data.admin) {
          adminResp = data.admin;
        } else if (data && data.email) {
          adminResp = data;
        } else {
          adminResp = null;
        }
        // store admin creds in state for developer inspection
        if (adminResp) setAdminCreds(adminResp);
        if (!resp.ok) {
          const msg = (data && data.error) || "Invalid admin credentials";
          setError(msg);
          setIsLoading(false);
          return;
        }

        // If server returned a minimal admin object, perform a final check client-side
        if (adminResp) {
          const inputEmail = (email || "").trim().toLowerCase();
          const storedEmail = (adminResp.email || "").trim().toLowerCase();
          const storedPassword = adminResp.password || "";
          if (inputEmail === storedEmail && password === storedPassword) {
            // Ensure a Firebase-authenticated user exists for this admin email so
            // Firestore listeners that rely on request.auth will succeed.
            try {
              // Try signing in via Firebase first (existing account)
              await loginUser(email.trim(), password);
            } catch (fbErr) {
              // If sign-in failed because the Firebase user doesn't exist, try
              // to create one programmatically and set its role to 'admin'.
              // registerUser will create the auth user and write a users/{uid}
              // document with role='admin'. This is only executed after server
              // verified the credentials against MongoDB.
              try {
                await registerUser(email.trim(), password, "admin", {
                  name: "Admin",
                });
              } catch (regErr) {
                console.error(
                  "Failed to provision Firebase admin user",
                  regErr
                );
                setError(
                  "Admin authenticated but failed to provision Firebase account. Contact support."
                );
                setIsLoading(false);
                return;
              }
            }

            // Persist optimistic auth role for header and routing, then navigate
            persistAuthRole("admin");
            try {
              navigate("/admin-dashboard");
            } catch (e) {
              try {
                navigate("/landing");
              } catch (_) {}
            }
            return;
          }
        }

        setError("Invalid admin credentials");
        setIsLoading(false);
        return;
      } catch (err) {
        console.error("admin login failed", err);
        setError("Admin login failed");
        setIsLoading(false);
        return;
      }
    }

    setIsLoading(true);
    const start = Date.now();
    try {
      const result = await loginUser(email, password);

      // If Firebase unexpectedly returns an 'admin' role, block it here and
      // require the dedicated MongoDB-backed admin login flow. We sign the
      // user out to avoid leaving an admin auth state in Firebase client.
      if (result && result.role === "admin") {
        try {
          await logoutUser();
        } catch (loErr) {
          console.warn("logout after firebase-admin-detected failed", loErr);
        }
        setError(
          "Admin accounts must sign in using the Admin login. Please choose 'Admin' and use the Admin sign-in flow."
        );
        return;
      }

      // Determine the authoritative role: prefer the role returned by the auth call,
      // fall back to the UI-selected role if none was returned.
      const acctRole = result && result.role ? result.role : role;

      // Enforce role segregation: if the authoritative role exists and does not
      // match the UI-selected role, immediately sign the user out and surface
      // a helpful error message rather than allowing a cross-role sign-in.
      if (result && result.role && result.role !== role) {
        try {
          await logoutUser();
        } catch (loErr) {
          // ignore logout errors but continue to block access
          console.warn("logout after role-mismatch failed", loErr);
        }
        setError(
          `Account role mismatch: this account is registered as '${result.role}'. Please sign in using the '${result.role}' option or use a different email.`
        );
        return;
      }

      // Set firstLogin flag when applicable (keep previous behaviour for users)
      if (result && result.firstLogin && acctRole === "user") {
        try {
          sessionStorage.setItem("firstLogin", "1");
        } catch (storageErr) {
          console.warn("sessionStorage set failed", storageErr);
        }
      }

      // Persist role briefly so the header can render correct nav while Firebase finishes
      persistAuthRole(acctRole);

      // Navigate to a sensible landing for the role (App will perform authoritative routing)
      const target =
        acctRole === "admin"
          ? "/admin-dashboard"
          : acctRole === "counsellor"
          ? "/counsellor-dashboard"
          : "/profile";
      try {
        navigate(target);
      } catch (e) {
        try {
          navigate("/landing");
        } catch (_) {}
      }
    } catch (err) {
      setError(err.message || "Login failed");
    } finally {
      const elapsed = Date.now() - start;
      if (elapsed < 2000)
        await new Promise((r) => setTimeout(r, 2000 - elapsed));
      setIsLoading(false);
    }
  };

  const handleSignup = async (e) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);
    const start = Date.now();
    try {
      // Disallow admin signup via Firebase - admin is handled by MongoDB
      if (role === "admin") {
        setError(
          "Admin account creation is not allowed via this form. Please use the Admin provisioning flow."
        );
        setIsLoading(false);
        return;
      }
      const result = await registerUser(
        email,
        password,
        role,
        role === "counsellor" ? { name, specialization } : { name }
      );

      // Show success toast
      toast.success(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">🎉 Account Created!</div>
          <div className="text-sm mt-1">
            Welcome to MindSphere, <span className="font-medium">{name}</span>!
            Your {role} account has been created successfully.
          </div>
        </div>,
        {
          position: "top-right",
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          className: "custom-success-toast",
        }
      );

      // Set firstLogin flag for users
      if (role === "user") {
        try {
          sessionStorage.setItem("firstLogin", "1");
        } catch (storageErr) {
          console.warn("sessionStorage set failed", storageErr);
        }
      }

      // Persist role briefly so the header can render correct nav while Firebase finishes
      persistAuthRole(role);
      // Navigate to role-specific landing
      const target =
        role === "admin"
          ? "/admin-dashboard"
          : role === "counsellor"
          ? "/counsellor-dashboard"
          : "/profile";
      try {
        navigate(target);
      } catch (e) {
        try {
          navigate("/landing");
        } catch (_) {}
      }
    } catch (err) {
      setError(err.message || "Signup failed");

      // Show error toast
      toast.error(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">❌ Signup Failed</div>
          <div className="text-sm mt-1">
            {err.message ||
              "Something went wrong during signup. Please try again."}
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
      if (elapsed < 2000)
        await new Promise((r) => setTimeout(r, 2000 - elapsed));
      setIsLoading(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setError("");
    setIsLoading(true);
    const start = Date.now();
    try {
      // Force Google sign-in to always be for users only
      const result = await signInWithGoogle("user");

      // Show success toast
      toast.success(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">🎉 Welcome to MindSphere!</div>
          <div className="text-sm mt-1">
            Successfully signed in with Google as{" "}
            <span className="font-medium">user</span>
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
        try {
          sessionStorage.setItem("firstLogin", "1");
        } catch (e) {
          /* ignore */
        }
      }

      // Navigate based on role returned by signInWithGoogle (usually 'user').
      // Additionally enforce that the account role matches the UI-selected role
      // (the Google button is only shown for users, but double-check here).
      const gRole = result && result.role ? result.role : "user";

      if (gRole !== role) {
        // Sign the user out and show an error when roles don't match.
        try {
          await logoutUser();
        } catch (loErr) {
          console.warn("logout after google role-mismatch failed", loErr);
        }
        setError(
          `Account role mismatch: this Google account is registered as '${gRole}'. Please sign in using the '${gRole}' option or use a different account.`
        );
        setIsLoading(false);
        return;
      }

      persistAuthRole(gRole);
      const target =
        gRole === "admin"
          ? "/admin-dashboard"
          : gRole === "counsellor"
          ? "/counsellor-dashboard"
          : "/profile";
      try {
        navigate(target);
      } catch (e) {
        try {
          navigate("/landing");
        } catch (_) {}
      }
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
      if (elapsed < 2000)
        await new Promise((r) => setTimeout(r, 2000 - elapsed));
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-black px-4 overflow-hidden">
      {/* Fallback image shown while video hasn't loaded or if the video fails */}
      <img
        src={fallback}
        alt="MindSphere background"
        className={`fixed inset-0 w-full h-full object-cover pointer-events-none z-0 transition-opacity duration-700 ${
          videoLoaded && !videoError ? "opacity-0" : "opacity-100"
        }`}
        aria-hidden="true"
      />

      {/* Background video - fixed to viewport and covers entire page.
          Add robust handlers and retry logic to avoid a blank/black background
          when the video resource fails or the browser aborts playback. */}
      <video
        ref={videoRef}
        className={`fixed inset-0 w-full h-full object-cover pointer-events-none z-0 transition-opacity duration-700 ${
          videoLoaded && !videoError ? "opacity-100" : "opacity-0"
        }`}
        src={bgVideo}
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster={fallback}
        onLoadedData={() => {
          setVideoLoaded(true);
          setVideoError(false);
        }}
        onCanPlay={() => {
          setVideoLoaded(true);
          setVideoError(false);
        }}
        onError={() => {
          // Try a few times before giving up and falling back to the poster image
          const maxRetries = 2;
          setVideoRetry((r) => {
            const next = (r || 0) + 1;
            if (next <= maxRetries) {
              // attempt reload with small backoff
              setTimeout(() => {
                try {
                  if (videoRef.current) {
                    // reload source and attempt to play
                    videoRef.current.load();
                    // attempt play; may be blocked in some browsers, ignore errors
                    videoRef.current.play().catch(() => {});
                  }
                } catch (_) {}
              }, 500 * next);
              return next;
            }
            // mark as failed after retries
            setVideoError(true);
            setVideoLoaded(false);
            return next;
          });
        }}
        onAbort={() => {
          // treat abort similarly to error
          setVideoError(true);
          setVideoLoaded(false);
        }}
        onStalled={() => {
          // try reloading once when stalled
          try {
            if (videoRef.current) {
              videoRef.current.load();
              videoRef.current.play().catch(() => {});
            }
          } catch (_) {}
        }}
        aria-hidden="true"
      />
      {/* Subtle overlay to improve contrast */}
      <div className="fixed inset-0 bg-black/30 pointer-events-none z-5" />

      <div className="relative z-10 bg-white/70 shadow-xl rounded-2xl overflow-hidden w-full max-w-4xl md:max-w-6xl grid grid-cols-1 md:grid-cols-2 m-2">
        {/* Left panel - simple illustration and brand */}
        <div className="hidden md:flex flex-col items-center justify-center p-6 bg-gradient-to-b from-white to-gray-50">
          <div className="w-40 h-40 md:w-52 md:h-52 rounded-xl bg-white flex items-center justify-center shadow-md">
            {/* MindSphere logo - set stable size and eager load to avoid layout jitter */}
            <img
              src={logo}
              alt="MindSphere Logo"
              className="w-32 h-32 md:w-44 md:h-44 object-contain"
              width="176"
              height="176"
              loading="eager"
            />
          </div>
          <h3 className="mt-6 text-3xl font-semibold text-[#263238]">
            MindSphere
          </h3>
          <p className="mt-4 text-base text-[#90A4AE] text-center px-8">
            Confidential, simple, and supportive mental health tools for
            students.
          </p>
        </div>

        {/* Right panel - form */}
        <div className="relative p-4 md:p-12">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-2xl md:text-3xl font-bold text-[#263238]">
              {isLogin ? "Welcome back" : "Create Account"}
            </h2>

            <div className="text-sm text-[#263238] flex items-center gap-2 flex-wrap justify-center">
              <span className="text-center">
                {isLogin ? "New here?" : "Already registered?"}
              </span>

              <button
                disabled={isLoading}
                type="button"
                onClick={() => {
                  setError("");
                  setIsLogin(!isLogin);
                }}
                className="px-3 py-1 rounded-md text-black font-medium cursor-pointer border border-black hover:bg-[#FF8C42] hover:text-white transition focus:outline-none focus:ring-4 focus:ring-[#FF8C42]/30 disabled:opacity-60"
              >
                {isLogin ? "Sign up" : "Login"}
              </button>
            </div>
          </div>

          <div className="my-2 text-sm text-[#263238] flex items-center justify-between gap-2">
            <div>
              {isLogin ? "Sign in to continue to MindSphere" : "A short signup to get started"}
            </div>
            {/* Show change credentials link inline with the sign-in title when admin is selected and on the login view */}
            {isLogin && role === 'admin' && (
              <button
                type="button"
                onClick={() => {showChangePopup()}}
                className="text-sm text-[#263238] underline"
              >
                Change Credentials
              </button>
            )}
          </div>

          {/* Role toggle */}
          <div className="my-4">
            <div className="flex items-center gap-2">
              <button
                disabled={isLoading}
                type="button"
                onClick={() => setRole("user")}
                className={`px-4 py-2 rounded-full text-sm font-medium cursor-pointer text-[#263238] ${
                  role === "user"
                    ? "bg-white/60 text-[#263238]"
                    : "text-[#90A4AE] hover:text-[#263238]"
                } disabled:opacity-60`}
              >
                User
              </button>
              <button
                disabled={isLoading}
                type="button"
                onClick={() => setRole("counsellor")}
                className={`px-4 py-2 rounded-full text-sm font-medium cursor-pointer text-[#263238] ${
                  role === "counsellor"
                    ? "bg-white/60 text-[#263238]"
                    : "text-[#90A4AE] hover:text-[#263238]"
                } disabled:opacity-60`}
              >
                Counsellor
              </button>
              {/* Only show admin toggle when explicitly requested via defaultRole or during login mode */}
              {(isLogin || typeof defaultRole !== "undefined") && (
                <button
                  disabled={isLoading}
                  type="button"
                  onClick={() => setRole("admin")}
                  className={`px-4 py-2 rounded-full text-sm font-medium cursor-pointer text-[#263238] ${
                    role === "admin"
                      ? "bg-white/60 text-[#263238]"
                      : "text-[#90A4AE] hover:text-[#263238]"
                  } disabled:opacity-60`}
                >
                  Admin
                </button>
              )}
            </div>
            
          </div>

          <form
            onSubmit={isLogin ? handleLogin : handleSignup}
            className="mt-6 space-y-4"
          >
            {!isLogin && role === "counsellor" && (
              <>
                <div>
                  <label className="block text-base font-semibold text-[#263238] mb-1">
                    Full name
                  </label>
                  <input
                    disabled={isLoading}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-5 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] focus:border-[#FF8C42] text-base"
                    placeholder="Jane Doe"
                    required
                  />
                </div>
                <div>
                  <label className="block text-base font-semibold text-[#263238] mb-1">
                    Specialization
                  </label>
                  <input
                    disabled={isLoading}
                    value={specialization}
                    onChange={(e) => setSpecialization(e.target.value)}
                    className="w-full px-5 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] focus:border-[#FF8C42] text-base"
                    placeholder="e.g. Child Psychologist"
                    required
                  />
                </div>
              </>
            )}

            {!isLogin && role === "user" && (
              <div>
                <label className="block text-base font-semibold text-[#263238] mb-1">
                  Full name
                </label>
                <input
                  disabled={isLoading}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-5 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] focus:border-[#FF8C42] text-base"
                  placeholder="John Doe"
                  required
                />
              </div>
            )}

            <div>
              <label className="block font-semibold text-base text-[#263238] mb-1">
                Email
              </label>
              <input
                disabled={isLoading}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full  px-5 py-3  border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#263238] hover:border-[#FF8C42] text-base"
                placeholder="you@school.edu"
                required
              />
            </div>

            <div>
              <label className="block font-semibold text-base text-[#263238] mb-1">
                Password
              </label>
              <div className="relative">
                <input
                  disabled={isLoading}
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-5 py-3 border border-gray-200 hover:border-[#FF8C42] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF8C42] pr-12 text-base"
                  placeholder="Enter password"
                  required
                />
                <button
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  disabled={isLoading}
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-sm md:text-base text-[#263238] cursor-pointer hover:text-[#e6732f]"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && <div className="text-base text-red-500">{error}</div>}

            <button
              disabled={isLoading}
              type="submit"
              className={`${btnPrimary} w-full flex items-center justify-center space-x-3`}
            >
              {isLoading ? (
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                  />
                </svg>
              ) : null}
              <span>{isLogin ? "Sign in" : "Create account"}</span>
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
          {isLogin && role === "user" && (
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
                className={`${btnSecondary} w-full mt-4 flex items-center justify-center space-x-3 disabled:opacity-70`}
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                <span className="text-[#263238]">Continue with Google</span>
              </button>
              {/* Back to home link placed below Google button */}
            </>
          )}
          <div className="mt-3 text-center">
            <Link to="/landing" className="text-sm text-[#263238]">
              Back to home
            </Link>
          </div>
        </div>
      </div>
      {roleMismatchDialogOpen && roleMismatchData ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-2 sm:px-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setRoleMismatchDialogOpen(false)}
          />

          <div className="relative bg-white rounded-lg shadow-lg z-60 w-full max-w-md sm:max-w-lg md:max-w-xl mx-auto p-4 sm:p-6 max-h-[80vh] overflow-y-auto">
            <h3 className="text-lg sm:text-xl font-semibold text-[#263238] mb-2">
              Role mismatch
            </h3>
            <p className="text-sm sm:text-base text-[#455A64] mb-3">
              The email <span className="font-medium break-words">{roleMismatchData.email}</span> is registered as
              <span className="font-semibold"> {' '}{roleMismatchData.registeredRole}</span> in the system.
            </p>
            <p className="text-sm sm:text-base text-[#607D8B] mb-4">
              Please choose one of the options below.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  // Switch the role selector to the registered role so user can re-submit
                  setRole(roleMismatchData.registeredRole);
                  setRoleMismatchDialogOpen(false);
                }}
                className="w-full px-4 py-2 rounded-md bg-[#FF8C42] text-white hover:bg-[#e6732f] text-sm sm:text-base"
              >
                {`Switch to '${roleMismatchData.registeredRole}'`}
              </button>

              <button
                type="button"
                onClick={() => {
                  // Close dialog and let the user update the email or cancel
                  setRoleMismatchDialogOpen(false);
                }}
                className="w-full px-4 py-2 rounded-md bg-white border border-gray-200 text-[#263238] hover:bg-gray-50 text-sm sm:text-base"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {/* Change Admin Credentials Popup */}
      {changePopupOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setChangePopupOpen(false)}
          />
          <div className="relative bg-white rounded-lg shadow-lg z-60 w-full max-w-md sm:max-w-lg md:max-w-xl mx-2 p-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg sm:text-xl font-semibold text-[#263238] my-2">
              Change admin credentials
            </h3>
            <p className="text-sm sm:text-base text-[#455A64] my-4">
              Enter current admin email and password, then provide new values.
            </p>

            <form onSubmit={handleChangeCredentials} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <label className="block text-sm sm:text-base font-medium text-[#263238] mb-1">Current email</label>
                <input
                  value={oldAdminUsername}
                  onChange={(e) => setOldAdminUsername(e.target.value)}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2 border border-gray-200 rounded-lg focus:outline-none text-sm sm:text-base"
                  placeholder="current admin email"
                  required
                />
              </div>

              <div className="flex flex-col">
                <label className="block text-sm sm:text-base font-medium text-[#263238] mb-1">New email</label>
                <input
                  value={newAdminUsername}
                  onChange={(e) => setNewAdminUsername(e.target.value)}
                  className="w-full px-3 py-2 sm:px-4 sm:py-2 border border-gray-200 rounded-lg focus:outline-none text-sm sm:text-base"
                  placeholder="new admin email"
                  required
                />
              </div>

              <div className="flex flex-col">
                <label className="block text-sm sm:text-base font-medium text-[#263238] mb-1">Current password</label>
                <input
                  value={oldAdminPassword}
                  onChange={(e) => setOldAdminPassword(e.target.value)}
                  type="password"
                  className="w-full px-3 py-2 sm:px-4 sm:py-2 border border-gray-200 rounded-lg focus:outline-none text-sm sm:text-base"
                  placeholder="current password"
                  required
                />
              </div>

              <div className="flex flex-col">
                <label className="block text-sm sm:text-base font-medium text-[#263238] mb-1">New password</label>
                <input
                  value={newAdminPassword}
                  onChange={(e) => setNewAdminPassword(e.target.value)}
                  type="password"
                  className="w-full px-3 py-2 sm:px-4 sm:py-2 border border-gray-200 rounded-lg focus:outline-none text-sm sm:text-base"
                  placeholder="new password"
                  required
                />
              </div>

              <div className="col-span-1 md:col-span-2">
                {changeError && <div className="text-sm text-red-500 mb-2">{changeError}</div>}

                <div className="flex items-center justify-end gap-2 mt-2">
                  <button
                    type="button"
                    onClick={() => setChangePopupOpen(false)}
                    className="px-4 py-2 rounded-md bg-white border border-gray-200 text-[#263238] hover:bg-gray-50"
                    disabled={changeLoading}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={changeLoading}
                    className="px-4 py-2 rounded-md bg-[#FF8C42] text-white hover:bg-[#e6732f]"
                  >
                    {changeLoading ? "Changing..." : "Change"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      ) : null}
      {/* Page-level full-screen loader removed; App.jsx provides the universal full-page loader. */}
    </div>
  );
};

export default AuthPage;
