import React, { useEffect, useState } from "react";
import userIcon from "/councellor.png";
import { db, auth } from "../services/firebase";
import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  setDoc,
} from "firebase/firestore";
// Page-level full-screen loader removed; App.jsx provides the universal full-page loader.
import { API } from "../hooks/helper";

const CounsellorDashboard = () => {
  const [appointments, setAppointments] = useState([]);
  const [counsellor, setCounsellor] = useState(null);
  // PHQ-9 state
  const [phqData, setPhqData] = useState([]);
  const [phqLoading, setPhqLoading] = useState(true);
  const [phqError, setPhqError] = useState(null);
  // Track which PHQ cards are expanded (show full answers inline)
  const [expandedPhqIds, setExpandedPhqIds] = useState([]);

  const togglePhqExpanded = (id) => {
    setExpandedPhqIds((prev) =>
      prev && prev.includes(id)
        ? prev.filter((x) => x !== id)
        : [...(prev || []), id]
    );
  };
  // Modal state for showing PHQ entries per appointment
  const [showPhqModal, setShowPhqModal] = useState(false);
  const [activePhqEntries, setActivePhqEntries] = useState([]);
  const [activeAppointment, setActiveAppointment] = useState(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [userResources, setUserResources] = useState([]);
  // Resource search history (search records by the user)
  const [resourceSearches, setResourceSearches] = useState([]);
  const [userChatHistory, setUserChatHistory] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState("");
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [MarkdownComponent, setMarkdownComponent] = useState(null);
  const [remarkGfmPlugin, setRemarkGfmPlugin] = useState(null);
  const [mdLoadError, setMdLoadError] = useState(false);
  const [sections, setSections] = useState({
    chatHistory: [],
    resources: [],
    phq9: [],
  });

  // Form state
  // showProfileForm can be boolean or an object { open: true, allowEditIdentity: true }
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLoadingState, setProfileLoadingState] = useState(true);

  const BACKEND = API;

  // Optional dev/admin token for summarize endpoints (Vite build-time env)
  const ADMIN_TOKEN_FOR_SUMMARY = import.meta.env.VITE_ADMIN_SUMMARY_TOKEN;
  const summarizeHeadersBase = { "Content-Type": "application/json" };
  if (ADMIN_TOKEN_FOR_SUMMARY)
    summarizeHeadersBase["Authorization"] = `Bearer ${ADMIN_TOKEN_FOR_SUMMARY}`;

  // Helpers for timestamp parsing/formatting
  const parseToMs = (ts) => {
    try {
      if (ts instanceof Date) return ts.getTime();
      if (typeof ts === "number") {
        // assume milliseconds if large, otherwise seconds
        return ts > 1e12 ? ts : ts * 1000;
      }
      if (typeof ts === "string") {
        const trimmed = ts.trim();
        if (/^\d+$/.test(trimmed)) {
          const n = Number(trimmed);
          return n > 1e12 ? n : n * 1000;
        }
        const d = new Date(trimmed);
        if (!isNaN(d.getTime())) return d.getTime();
        return 0;
      }
      const d = new Date(ts);
      return !isNaN(d.getTime()) ? d.getTime() : 0;
    } catch (e) {
      return 0;
    }
  };

  const formatTimestamp = (ts) => {
    const ms = parseToMs(ts);
    if (!ms) return "Unknown";
    try {
      const d = new Date(ms);
      return d.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });
    } catch (e) {
      return "Unknown";
    }
  };

  // Helper to format date-only (no time)
  const formatDateOnly = (ts) => {
    const ms = parseToMs(ts);
    if (!ms) return "Unknown";
    try {
      const d = new Date(ms);
      return d.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch (e) {
      return "Unknown";
    }
  };

  const [apptFilter, setApptFilter] = useState("New"); // New | Accepted | Rejected

  // Try to dynamically load react-markdown and remark-gfm so dev server won't fail
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import(/* @vite-ignore */ "react-markdown");
        const gfm = await import(/* @vite-ignore */ "remark-gfm");
        if (!mounted) return;
        setMarkdownComponent(() => mod.default || mod);
        setRemarkGfmPlugin(() => gfm.default || gfm);
      } catch (e) {
        console.warn("react-markdown/remark-gfm not available:", e);
        if (mounted) setMdLoadError(true);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  // For counsellor dashboard we should not fetch/show resources and peer posts
  // when viewing appointment details. This flag drives conditional rendering
  // and the fetch options below.
  const hideResourcesAndPosts = true;

  // Fetch counsellor info
  useEffect(() => {
    const fetchCounsellorInfo = async () => {
      if (!auth.currentUser) return;
      setProfileLoadingState(true);
      try {
        const docRef = doc(db, "counsellors", auth.currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          const data = docSnap.data();
          setCounsellor({ id: docSnap.id, ...data });

          // Check if profile is complete (has all required fields)
          const requiredFields = [
            "name",
            "number",
            "email",
            "specialization",
            "experience",
            "address",
            "careerInformation",
          ];
          const isProfileComplete = requiredFields.every(
            (field) => data[field] && data[field].trim() !== ""
          );

          if (!isProfileComplete) {
            // Profile is incomplete — do not auto-open the modal.
            // The UI should only open the profile form when the user explicitly
            // clicks the Edit button. We keep the counsellor state so the
            // Edit button can populate the form when opened.
          }
        } else {
          // No profile exists — do not auto-open the modal. Let the user open
          // the form via the Edit profile button so it's explicit.
        }
      } catch (error) {
        console.error("Error fetching counsellor info:", error);
        // On error, do not auto-open the form; allow the user to open it
        // manually via the Edit profile button. This avoids surprising
        // modals appearing on load when network issues occur.
      } finally {
        setProfileLoadingState(false);
      }
    };
    fetchCounsellorInfo();
  }, []);

  // Fetch appointments
  // Listen for details loaded event dispatched by loadDetailsForUser
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      setUserResources(d.resourcesList || []);
      setResourceSearches(d.resourceSearches || []);
      // Log resource searches for debugging / counsellor visibility
      setUserChatHistory(d.chatMsgs || []);
      // setUserPosts(d.posts || []);
      setDetailsLoading(false);
    };
    window.addEventListener("mindsphere:detailsLoaded", handler);
    return () =>
      window.removeEventListener("mindsphere:detailsLoaded", handler);
  }, []);
  useEffect(() => {
    const fetchAppointments = async () => {
      if (!auth.currentUser) return;
      try {
        const q = query(
          collection(db, "appointments"),
          where("counsellorId", "==", auth.currentUser.uid)
        );
        const snapshot = await getDocs(q);
        setAppointments(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        );
      } catch (error) {
        console.error("Error fetching appointments:", error);
      }
    };
    fetchAppointments();
  }, []);

  // Fetch PHQ-9 results
  useEffect(() => {
    const fetchPhqData = async () => {
      setPhqLoading(true);
      try {
        // Server now exposes GET /api/phq9 which returns { phq9_responses: [...] }
        const res = await fetch(`${BACKEND}/api/phq9`);
        if (!res.ok) {
          let errText = `HTTP ${res.status}`;
          try {
            const errBody = await res.json();
            errText = errBody.error || JSON.stringify(errBody);
          } catch (e) {
            const txt = await res.text();
            errText = txt || errText;
          }
          throw new Error(errText);
        }
        const data = await res.json();
        const arr = data.phq9_responses || [];
        // Normalize entries to the shape used in the UI
        const computeSeverity = (score) => {
          if (score >= 20) return "Severe";
          if (score >= 15) return "Moderately severe";
          if (score >= 10) return "Moderate";
          if (score >= 5) return "Mild";
          return "Minimal";
        };
        const normalized = arr.map((r) => {
          const originalTs =
            r.timestamp ||
            r.submittedAt ||
            r.submitted_at ||
            r.date ||
            r.createdAt ||
            null;
          const parsedMs =
            typeof parseToMs === "function" ? parseToMs(originalTs) : 0;
          const total =
            r.total_score ??
            r.totalScore ??
            (Array.isArray(r.answers)
              ? r.answers.reduce((s, a) => s + (Number(a) || 0), 0)
              : undefined);
          return {
            ...r,
            // keep the raw DB timestamp so counsellor can see exact submitted value
            submittedAt: originalTs,
            // machine-friendly parsed ms for sorting
            parsed_timestamp_ms: parsedMs,
            user_email: (r.user_email || r.userEmail || "").toLowerCase(),
            totalScore: total,
            severity: computeSeverity(total || 0),
          };
        });
        setPhqData(normalized);
      } catch (err) {
        console.error("Error fetching PHQ-9 results:", err);
        setPhqError(err.message || "Failed to load PHQ-9 results");
      } finally {
        setPhqLoading(false);
      }
    };
    fetchPhqData();
  }, []);

  // Close modal on Escape key
  useEffect(() => {
    if (!showPhqModal) return;
    const onKey = (e) => {
      if (e.key === "Escape") setShowPhqModal(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showPhqModal]);

  const getStatusColor = (status) => {
    switch (status) {
      case "booked":
        return "bg-blue-100 text-blue-700";
      case "accepted":
        return "bg-green-100 text-green-700";
      case "completed":
        return "bg-green-100 text-green-700";
      case "rejected":
        return "bg-red-100 text-red-700";
      case "cancelled":
        return "bg-red-100 text-red-700";
      default:
        return "bg-gray-100 text-gray-700";
    }
  };

  const handleProfileSubmit = async (formData) => {
    setProfileLoading(true);
    try {
      const profileData = {
        ...formData,
        email: auth.currentUser.email, // Use the authenticated user's email
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Save to Firestore
      const docRef = doc(db, "counsellors", auth.currentUser.uid);
      // Diagnostic: log UID and keys being written to help debug permissions
      await setDoc(docRef, profileData, { merge: true });

      // Update local state
      setCounsellor({ id: auth.currentUser.uid, ...profileData });
      setShowProfileForm(false);
    } catch (error) {
      console.error("Error saving profile:", error);
      alert("Error saving profile. Please try again.");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleProfileCancel = () => {
    setShowProfileForm(false);
  };

  // Inlined CounsellorProfileForm (previously in components)
  function CounsellorProfileFormInline({
    user = {},
    onSubmit,
    onCancel,
    isLoading = false,
    allowEditIdentity = false,
  }) {
    const [form, setForm] = useState(() => ({
      name: user.name || "",
      number: user.number || user.phone || user.contact || "",
      email: user.email || "",
      specialization: user.specialization || "",
      experience: user.experience || "",
      address: user.address || "",
      careerInformation: user.careerInformation || user.careerInformation || "",
      qualifications: user.qualifications || "",
      languages: user.languages || "",
      consultationFee: user.consultationFee || user.consultationFee || "",
      availability: user.availability || "",
      bio: user.bio || "",
      image: user.image || user.photo || "",
    }));

    // Keep form in sync if parent provides user after initial render
    React.useEffect(() => {
      if (user) {
        setForm((prev) => ({
          ...prev,
          name: user.name || prev.name,
          number: user.number || user.phone || user.contact || prev.number,
          email: user.email || prev.email,
          specialization: user.specialization || prev.specialization,
          experience: user.experience || prev.experience,
          address: user.address || prev.address,
          careerInformation: user.careerInformation || prev.careerInformation,
          qualifications: user.qualifications || prev.qualifications,
          languages: user.languages || prev.languages,
          consultationFee: user.consultationFee || prev.consultationFee,
          availability: user.availability || prev.availability,
          bio: user.bio || prev.bio,
          image: user.image || user.photo || prev.image,
        }));
      }
    }, [user]);

    const handleChange = (e) => {
      const { name, value } = e.target;
      setForm((prev) => ({ ...prev, [name]: value }));
    };

    const submit = (e) => {
      e.preventDefault();
      // No fields are mandatory — submit whatever the user provided
      onSubmit && onSubmit(form);
    };

    React.useEffect(() => {
      const onKey = (e) => {
        if (e.key === "Escape") onCancel && onCancel();
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [onCancel]);

    return (
      <div
        className="fixed inset-0 z-50 flex items-start sm:items-center justify-center bg-black/40 p-4 overflow-y-auto"
        onClick={onCancel}
      >
        <form
          onSubmit={submit}
          role="dialog"
          aria-modal="true"
          aria-label="Counsellor profile form"
          className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-4 sm:p-6 mx-2 sm:mx-4 box-border max-h-[80vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg sm:text-xl font-bold mb-2">
              Complete your counsellor profile
            </h3>
            <button
              type="button"
              aria-label="Close profile form"
              onClick={onCancel}
              className="ml-auto text-gray-500 hover:text-gray-700 p-1 rounded focus:outline-none"
            >
              ×
            </button>
          </div>

          <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
            {allowEditIdentity ? (
              <>
                <div>
                  <label className="text-xs text-gray-500">Name</label>
                  <input
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className="border p-2 rounded w-full block mt-1 text-sm sm:text-base"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Email</label>
                  <input
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    className="border p-2 rounded w-full block mt-1 text-sm sm:text-base"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">
                    Specialization
                  </label>
                  <input
                    name="specialization"
                    value={form.specialization}
                    onChange={handleChange}
                    className="border p-2 rounded w-full block mt-1 text-sm sm:text-base"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="col-span-1 sm:col-span-1">
                  <label className="text-xs text-gray-500">Name</label>
                  <div className="font-medium text-gray-800 truncate">
                    {form.name || "—"}
                  </div>
                </div>
                <div className="col-span-1 sm:col-span-1">
                  <label className="text-xs text-gray-500">Email</label>
                  <div className="font-medium text-gray-800 truncate">
                    {form.email || "—"}
                  </div>
                </div>
                <div className="col-span-1 sm:col-span-1">
                  <label className="text-xs text-gray-500">
                    Specialization
                  </label>
                  <div className="font-medium text-gray-800 truncate">
                    {form.specialization || "—"}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-gray-500">Phone number</label>
              <input
                name="number"
                value={form.number}
                onChange={handleChange}
                placeholder="Phone number"
                className="border p-2 rounded w-full block mt-1 text-sm sm:text-base"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">
                Experience (years)
              </label>
              <input
                name="experience"
                value={form.experience}
                onChange={handleChange}
                placeholder="Experience (years)"
                className="border p-2 rounded w-full block mt-1"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">Consultation Fee</label>
              <input
                name="consultationFee"
                value={form.consultationFee}
                onChange={handleChange}
                placeholder="Consultation Fee"
                className="border p-2 rounded w-full block mt-1"
              />
            </div>

            <div>
              <label className="text-xs text-gray-500">Languages</label>
              <input
                name="languages"
                value={form.languages}
                onChange={handleChange}
                placeholder="Languages (comma separated)"
                className="border p-2 rounded w-full block mt-1"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500">Qualifications</label>
              <input
                name="qualifications"
                value={form.qualifications}
                onChange={handleChange}
                placeholder="Qualifications"
                className="border p-2 rounded w-full block mt-1"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500">Availability</label>
              <input
                name="availability"
                value={form.availability}
                onChange={handleChange}
                placeholder="Availability"
                className="border p-2 rounded w-full block mt-1"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500">Address</label>
              <input
                name="address"
                value={form.address}
                onChange={handleChange}
                placeholder="Address"
                className="border p-2 rounded w-full block mt-1"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500">
                Career Information
              </label>
              <textarea
                name="careerInformation"
                value={form.careerInformation}
                onChange={handleChange}
                placeholder="Career Information"
                className="border p-2 rounded w-full block mt-1 min-h-[80px] sm:min-h-[120px] resize-vertical text-sm sm:text-base"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="text-xs text-gray-500">Short bio</label>
              <textarea
                name="bio"
                value={form.bio}
                onChange={handleChange}
                placeholder="Short bio"
                className="border p-2 rounded w-full block mt-1 min-h-[70px] sm:min-h-[100px] resize-vertical text-sm sm:text-base"
              />
            </div>
          </div>

          <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded bg-gray-100 w-full sm:w-auto"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="px-4 py-2 rounded bg-blue-600 text-white w-full sm:w-auto"
            >
              {isLoading ? "Saving..." : "Save profile"}
            </button>
          </div>
        </form>
      </div>
    );
  }

  // Show a compact inline loading placeholder while fetching profile (no full-page loader)
  if (profileLoadingState) {
    return (
      <div className="py-12 flex items-center justify-center">
        <svg className="animate-spin h-10 w-10 text-gray-600" viewBox="0 0 24 24" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
      </div>
    );
  }
  // notify the app that this page has finished its initial render
  try {
    window.dispatchEvent(new CustomEvent("mindsphere:pageReady"));
  } catch (e) {}

  return (
    <div className="max-w-6xl mx-auto px-4 py-24">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-blue-700 mb-6">
          Counsellor Dashboard
        </h1>

        {/* Profile Form Modal */}
        {showProfileForm && (
          <CounsellorProfileFormInline
            user={
              counsellor || {
                name: auth.currentUser?.displayName || "",
                email: auth.currentUser?.email || "",
                specialization: "",
              }
            }
            onSubmit={handleProfileSubmit}
            onCancel={handleProfileCancel}
            isLoading={profileLoading}
            allowEditIdentity={
              typeof showProfileForm === "object"
                ? !!showProfileForm.allowEditIdentity
                : false
            }
          />
        )}

        {/* Counsellor Info */}
        {counsellor && (
          <div className="bg-white shadow-lg rounded-2xl p-4 sm:p-6 mb-8">
            <div className="flex flex-col md:flex-row items-start gap-6">
              <div className="flex-shrink-0 w-20 h-20 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-full border-2 border-blue-100 overflow-hidden bg-blue-50 flex items-center justify-center mx-auto md:mx-0">
                <img
                  src={counsellor.image || userIcon}
                  alt={counsellor.name || "Counsellor"}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    /* fall back to bundled logo if provided image fails to load */
                    // avoid infinite loop if userIcon also errors
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = userIcon;
                  }}
                />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-start justify-between gap-4 flex-col sm:flex-row sm:items-center">
                  <div className="flex-1 min-w-0">
                    <h2 className="text-lg sm:text-2xl md:text-3xl font-bold text-gray-800 mb-2">
                      {counsellor.name}
                    </h2>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm sm:text-base">
                      <div className="min-w-0 break-words">
                        <p className="text-gray-600 mb-2">
                          <span className="font-medium">Specialization:</span>{" "}
                          <span className="inline">
                            {counsellor.specialization || "—"}
                          </span>
                        </p>
                        <p className="text-gray-600 mb-2 break-words">
                          <span className="font-medium">📧 Email:</span>{" "}
                          <span className="inline">{counsellor.email}</span>
                        </p>
                        <p className="text-gray-600 mb-2">
                          <span className="font-medium">📞 Phone:</span>{" "}
                          <span className="inline">
                            {counsellor.number || "—"}
                          </span>
                        </p>
                        <p className="text-gray-600 mb-2">
                          <span className="font-medium">Experience:</span>{" "}
                          <span className="inline">
                            {counsellor.experience || "—"} years
                          </span>
                        </p>
                        {counsellor.location && (
                          <p className="text-gray-600 mb-2 break-words">
                            <span className="font-medium">Location:</span>{" "}
                            <span className="inline">
                              {counsellor.location}
                            </span>
                          </p>
                        )}
                      </div>
                      <div className="min-w-0 break-words">
                        {counsellor.qualifications && (
                          <p className="text-gray-600 mb-2">
                            <span className="font-medium">Qualifications:</span>{" "}
                            {counsellor.qualifications}
                          </p>
                        )}
                        {counsellor.languages && (
                          <p className="text-gray-600 mb-2">
                            <span className="font-medium">Languages:</span>{" "}
                            {counsellor.languages}
                          </p>
                        )}
                        {counsellor.consultationFee && (
                          <p className="text-gray-600 mb-2">
                            <span className="font-medium">
                              Consultation Fee:
                            </span>{" "}
                            ₹{counsellor.consultationFee}
                          </p>
                        )}
                        {counsellor.availability && (
                          <p className="text-gray-600 mb-2">
                            <span className="font-medium">Availability:</span>{" "}
                            {counsellor.availability}
                          </p>
                        )}
                      </div>
                    </div>

                    {counsellor.address && (
                      <div className="mt-3">
                        <p className="text-gray-600 text-sm sm:text-base break-words">
                          <span className="font-medium">Address:</span>{" "}
                          {counsellor.address}
                        </p>
                      </div>
                    )}

                    {counsellor.careerInformation && (
                      <div className="mt-3">
                        <p className="text-gray-600 text-sm sm:text-base">
                          <span className="font-medium">
                            Career Information:
                          </span>
                        </p>
                        <p className="text-gray-600 text-sm sm:text-base mt-1 max-h-40 overflow-auto">
                          {counsellor.careerInformation}
                        </p>
                      </div>
                    )}

                    {counsellor.bio && (
                      <div className="mt-3">
                        <p className="text-gray-600 text-sm sm:text-base">
                          <span className="font-medium">Bio:</span>
                        </p>
                        <p className="text-gray-600 text-sm sm:text-base mt-1 max-h-40 overflow-auto">
                          {counsellor.bio}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-3 md:mt-0 flex-shrink-0 w-full md:w-auto md:self-start md:ml-auto">
                <button
                  onClick={() => setShowProfileForm(true)}
                  className="px-4 py-2 rounded bg-blue-50 text-blue-700 w-full md:w-auto text-center text-sm sm:text-base"
                >
                  Edit profile
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Booking Appointments Section */}
        <div className="mb-8">
          <h2 className="text-xl sm:text-2xl font-bold text-blue-700 mb-4">
            Booking Appointments
          </h2>
          <div className="mb-4 flex items-center gap-2">
            <button
              className={`px-3 py-1 rounded ${
                apptFilter === "New"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700"
              }`}
              onClick={() => setApptFilter("New")}
            >
              New
            </button>
            <button
              className={`px-3 py-1 rounded ${
                apptFilter === "Accepted"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700"
              }`}
              onClick={() => setApptFilter("Accepted")}
            >
              Accepted
            </button>
            <button
              className={`px-3 py-1 rounded ${
                apptFilter === "Rejected"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-100 text-gray-700"
              }`}
              onClick={() => setApptFilter("Rejected")}
            >
              Rejected
            </button>
          </div>
          {appointments.length === 0 ? (
            <p className="text-gray-500 text-center py-10 text-base sm:text-lg">
              No booked appointments yet.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
              {appointments
                .filter((appt) => {
                  if (apptFilter === "New")
                    return (
                      !appt.status ||
                      appt.status === "booked" ||
                      appt.status === "pending" ||
                      appt.status === "new"
                    );
                  if (apptFilter === "Accepted")
                    return (
                      appt.status === "accepted" || appt.status === "completed"
                    );
                  if (apptFilter === "Rejected")
                    return (
                      appt.status === "rejected" || appt.status === "cancelled"
                    );
                  return true;
                })
                .map((appt) => (
                  <div
                    key={appt.id}
                    className="bg-white shadow-lg rounded-2xl p-4 sm:p-5 lg:p-6 hover:shadow-2xl transition duration-300 w-full"
                  >
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
                      <h3 className="text-lg sm:text-xl font-semibold text-gray-800">
                        {appt.userName}
                      </h3>
                      <span
                        className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(
                          appt.status
                        )}`}
                      >
                        {appt.status}
                      </span>
                    </div>
                    <div className="text-gray-600 text-sm sm:text-base space-y-1 break-words">
                      {appt.email && (
                        <p className="truncate">📧 {appt.email}</p>
                      )}
                      {appt.contact && <p>📞 {appt.contact}</p>}
                      <p>⏰ {new Date(appt.time).toLocaleString()}</p>

                      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            // show details modal
                            const email = (
                              appt.email ||
                              appt.user_email ||
                              appt.userEmail ||
                              ""
                            )
                              .toString()
                              .toLowerCase();
                            const entries = phqData.filter(
                              (p) =>
                                (p.user_email || p.userEmail || "")
                                  .toString()
                                  .toLowerCase() === email
                            );
                            setActivePhqEntries(entries);
                            setActiveAppointment(appt);
                            setShowDetailsModal(true);
                            setDetailsLoading(true);
                            // load extra details (resources, chat history). Skip resources/posts for counsellor view
                            loadDetailsForUser(email, appt, {
                              fetchResources: !hideResourcesAndPosts,
                              fetchPosts: !hideResourcesAndPosts,
                            }).then(() => setDetailsLoading(false));
                          }}
                          className="px-4 py-2 rounded bg-blue-50 text-blue-700 text-sm sm:text-base hover:bg-blue-100 w-full sm:w-auto text-center"
                        >
                          View Details
                        </button>
                        {/* Show accept/reject only when appointment is not already accepted/rejected */}
                        {!(
                          appt.status === "accepted" ||
                          appt.status === "rejected" ||
                          appt.status === "completed" ||
                          appt.status === "cancelled"
                        ) && (
                          <>
                            <button
                              type="button"
                              onClick={async () => {
                                // Accept appointment: ensure signed-in counsellor and then update Firestore
                                if (!auth || !auth.currentUser) {
                                  alert(
                                    "You must be signed in to accept appointments."
                                  );
                                  return;
                                }
                                // log diagnostic info to help debug permission issues
                                const currentUid = auth.currentUser.uid;
                                
                                // ensure the current user is the assigned counsellor for this appointment
                                if (
                                  appt.counsellorId &&
                                  appt.counsellorId !== currentUid
                                ) {
                                  alert(
                                    "You are not authorized to modify this appointment."
                                  );
                                  return;
                                }
                                try {
                                  const docRef = doc(
                                    db,
                                    "appointments",
                                    appt.id
                                  );
                                  await setDoc(
                                    docRef,
                                    { status: "accepted" },
                                    { merge: true }
                                  );
                                  // update local state
                                  setAppointments((prev) =>
                                    prev.map((a) =>
                                      a.id === appt.id
                                        ? { ...a, status: "accepted" }
                                        : a
                                    )
                                  );

                                  // notify backend and include ID token for server-side verification
                                  try {
                                    const idToken =
                                      await auth.currentUser.getIdToken();
                                    await fetch(
                                      `${BACKEND}/api/appointments/${appt.id}/status`,
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                          Authorization: `Bearer ${idToken}`,
                                        },
                                        body: JSON.stringify({
                                          status: "accepted",
                                          counsellorId: currentUid,
                                          email: appt.email,
                                        }),
                                      }
                                    );
                                  } catch (e) {
                                    console.warn(
                                      "Backend status update failed",
                                      e
                                    );
                                  }
                                } catch (e) {
                                  console.error(
                                    "Failed to accept appointment",
                                    e?.code || e?.message || e
                                  );
                                  if (e?.code === "permission-denied") {
                                    alert(
                                      "Permission denied: your account does not have permission to accept this appointment. Please ensure you're signed in with the correct counsellor account."
                                    );
                                  } else {
                                    alert(
                                      "Failed to accept appointment. See console for details."
                                    );
                                  }
                                }
                              }}
                              className="px-4 py-2 rounded bg-green-50 text-green-700 text-sm sm:text-base hover:bg-green-100 w-full sm:w-auto text-center"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                // Reject appointment: ensure signed-in counsellor and then update Firestore
                                if (!auth || !auth.currentUser) {
                                  alert(
                                    "You must be signed in to reject appointments."
                                  );
                                  return;
                                }
                                const currentUid = auth.currentUser.uid;
                                
                                if (
                                  appt.counsellorId &&
                                  appt.counsellorId !== currentUid
                                ) {
                                  alert(
                                    "You are not authorized to modify this appointment."
                                  );
                                  return;
                                }
                                try {
                                  const docRef = doc(
                                    db,
                                    "appointments",
                                    appt.id
                                  );
                                  await setDoc(
                                    docRef,
                                    { status: "rejected" },
                                    { merge: true }
                                  );
                                  setAppointments((prev) =>
                                    prev.map((a) =>
                                      a.id === appt.id
                                        ? { ...a, status: "rejected" }
                                        : a
                                    )
                                  );

                                  // notify backend with ID token
                                  try {
                                    const idToken =
                                      await auth.currentUser.getIdToken();
                                    await fetch(
                                      `${BACKEND}/api/appointments/${appt.id}/status`,
                                      {
                                        method: "POST",
                                        headers: {
                                          "Content-Type": "application/json",
                                          Authorization: `Bearer ${idToken}`,
                                        },
                                        body: JSON.stringify({
                                          status: "rejected",
                                          counsellorId: currentUid,
                                          email: appt.email,
                                        }),
                                      }
                                    );
                                  } catch (e) {
                                    console.warn(
                                      "Backend status update failed",
                                      e
                                    );
                                  }
                                } catch (e) {
                                  console.error(
                                    "Failed to reject appointment",
                                    e?.code || e?.message || e
                                  );
                                  if (e?.code === "permission-denied") {
                                    alert(
                                      "Permission denied: your account does not have permission to reject this appointment."
                                    );
                                  } else {
                                    alert(
                                      "Failed to reject appointment. See console for details."
                                    );
                                  }
                                }
                              }}
                              className="px-4 py-2 rounded bg-red-50 text-red-700 text-sm sm:text-base hover:bg-red-100 w-full sm:w-auto text-center"
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
        {/* PHQ modal (per-appointment) */}
        {showPhqModal && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setShowPhqModal(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-4 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    PHQ-9 Submissions for{" "}
                    {activeAppointment?.userName ||
                      activeAppointment?.email ||
                      "Client"}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Appointment:{" "}
                    {activeAppointment?.time
                      ? new Date(activeAppointment.time).toLocaleString()
                      : "Unknown"}
                  </p>
                </div>
                <div>
                  <button
                    onClick={() => setShowPhqModal(false)}
                    className="px-3 py-1 rounded bg-gray-100"
                  >
                    Close
                  </button>
                </div>
              </div>

              <div className="mt-4">
                {phqLoading ? (
                  <p className="text-gray-600">Loading PHQ-9 submissions...</p>
                ) : activePhqEntries.length === 0 ? (
                  <p className="text-gray-500">
                    No PHQ-9 submissions from this client.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {(Array.isArray(activePhqEntries)
                      ? activePhqEntries.slice()
                      : []
                    )
                      // Show latest DB entries first: reverse the array (preserves DB insertion order)
                      .slice()
                      .reverse()
                      .map((p) => {
                        // Show date-only (YYYY-MM-DD) derived from raw DB timestamp
                        const _raw =
                          p.submittedAt ||
                          p.timestamp ||
                          p.submitted_at ||
                          p.date ||
                          p.parsed_timestamp_ms;
                        let time = "Unknown";
                        if (_raw) {
                          try {
                            if (
                              typeof _raw === "string" &&
                              /^\d{4}-\d{2}-\d{2}/.test(_raw)
                            ) {
                              // ISO-like string: take YYYY-MM-DD
                              time = _raw.slice(0, 10);
                            } else if (typeof _raw === "number") {
                              // epoch seconds or ms
                              const ms = _raw > 1e12 ? _raw : _raw * 1000;
                              time = new Date(ms).toISOString().slice(0, 10);
                            } else {
                              const d = new Date(_raw);
                              if (!isNaN(d.getTime()))
                                time = d.toISOString().slice(0, 10);
                            }
                          } catch (e) {
                            time = String(_raw).slice(0, 10);
                          }
                        }
                        const answers = Array.isArray(p.answers)
                          ? p.answers.join(", ")
                          : "";
                        return (
                          <div
                            key={p.id || p.user_email + "-" + time}
                            className="bg-gray-50 border rounded-lg p-3"
                          >
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-sm font-medium">
                                {p.user_email || "Unknown"}
                              </div>
                              <div className="text-xs text-gray-500">
                                {time}
                              </div>
                            </div>
                            <div className="text-sm text-gray-700">
                              Score:{" "}
                              <strong>
                                {p.totalScore ?? p.total_score ?? "—"}
                              </strong>
                            </div>
                            <div className="text-sm text-gray-700">
                              Severity:{" "}
                              <strong>{p.severity || "Unknown"}</strong>
                            </div>
                            {answers && (
                              <div className="mt-2 text-sm text-gray-600">
                                <div className="font-medium text-gray-700 mb-1">
                                  Answers
                                </div>
                                <div className="text-xs bg-white p-3 rounded-md border">
                                  {answers}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
        {/* Details modal (View Details) */}
        {showDetailsModal && activeAppointment && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
            onClick={() => setShowDetailsModal(false)}
          >
            <div
              className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Heading */}
              <div className="flex justify-between gap-4 sticky top-0 left-0 right-0 bg-white p-4 border-b z-10">
                <div>
                  <h3 className="text-lg font-semibold">
                    Appointment Details:{" "}
                    {activeAppointment.userName || activeAppointment.email}
                  </h3>
                  <p className="text-sm text-gray-500">
                    Time:{" "}
                    {activeAppointment.time
                      ? new Date(activeAppointment.time).toLocaleString()
                      : "Unknown"}
                  </p>
                </div>
                <div>
                  <button
                    onClick={() => setShowDetailsModal(false)}
                    className="px-3 py-1 rounded bg-gray-100"
                  >
                    Close
                  </button>
                </div>
              </div>

              {/* Content */}
              <div className="m-2 p-2 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div>
                    <div className="text-xs text-gray-500">Name</div>
                    <div className="font-medium">
                      {activeAppointment.userName}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Email</div>
                    <div className="font-medium">{activeAppointment.email}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Contact</div>
                    <div className="font-medium">
                      {activeAppointment.contact}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Status</div>
                    <div className="font-medium">
                      {activeAppointment.status}
                    </div>
                  </div>
                  <div className="sm:col-span-2">
                    <div className="text-xs text-gray-500">Notes</div>
                    <div className="font-medium whitespace-pre-wrap">
                      {activeAppointment.notes || "—"}
                    </div>
                  </div>
                </div>

                <div className="my-2">
                  <h4 className="text-sm font-semibold">PHQ-9 Submissions</h4>
                  {(!activePhqEntries || activePhqEntries.length === 0) &&
                  (!phqData || phqData.length === 0) ? (
                    <p className="text-sm text-gray-500">No submissions.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {(activePhqEntries && activePhqEntries.length > 0
                        ? (activePhqEntries || []).slice().reverse()
                        : // derive from phqData using activeAppointment email
                          (phqData || [])
                            .filter((r) => {
                              const email = (
                                activeAppointment?.email ||
                                activeAppointment?.user_email ||
                                activeAppointment?.userEmail ||
                                ""
                              )
                                .toString()
                                .toLowerCase();
                              const u = (
                                r.user_email ||
                                r.userEmail ||
                                r.email ||
                                ""
                              )
                                .toString()
                                .toLowerCase();
                              return email && u && u === email;
                            })
                            .slice()
                            .reverse()
                      ).map((p) => {
                        const idKey =
                          p.id ||
                          `${p.user_email}-${
                            p.parsed_timestamp_ms ||
                            parseToMs(p.submittedAt || p.timestamp || p.date) ||
                            Math.random()
                          }`;
                        // Show date-only (YYYY-MM-DD) derived from raw DB timestamp
                        const _raw2 =
                          p.submittedAt ||
                          p.timestamp ||
                          p.submitted_at ||
                          p.date;
                        let time = "Unknown";
                        if (_raw2) {
                          try {
                            if (
                              typeof _raw2 === "string" &&
                              /^\d{4}-\d{2}-\d{2}/.test(_raw2)
                            ) {
                              time = _raw2.slice(0, 10);
                            } else if (typeof _raw2 === "number") {
                              const ms2 = _raw2 > 1e12 ? _raw2 : _raw2 * 1000;
                              time = new Date(ms2).toISOString().slice(0, 10);
                            } else {
                              const d2 = new Date(_raw2);
                              if (!isNaN(d2.getTime()))
                                time = d2.toISOString().slice(0, 10);
                            }
                          } catch (e) {
                            time = String(_raw2).slice(0, 10);
                          }
                        }
                        const answersText = Array.isArray(p.answers)
                          ? p.answers.join(", ")
                          : p.answers || p.content || "";
                        const isExpanded = expandedPhqIds.includes(idKey);
                        return (
                          <div
                            key={idKey}
                            className="bg-gray-50 border rounded-lg p-3 flex flex-col justify-between"
                          >
                            <div>
                              <div className="flex items-center justify-between">
                                <div className="text-sm font-medium text-gray-800 truncate">
                                  {p.user_email || p.email || "Unknown"}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {time}
                                </div>
                              </div>
                              <div className="text-sm text-gray-700 mt-2">
                                Score:{" "}
                                <strong>
                                  {p.totalScore ?? p.total_score ?? "—"}
                                </strong>
                                <span className="ml-2 text-xs text-gray-500">
                                  {p.severity}
                                </span>
                              </div>
                              {isExpanded && answersText && (
                                <div className="mt-3 text-sm text-gray-600">
                                  <div className="font-medium text-gray-700 mb-1">
                                    Answers
                                  </div>
                                  <div className="text-xs bg-white p-3 rounded-md border whitespace-pre-wrap">
                                    {answersText}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="mt-3 flex items-center justify-end gap-2">
                              <button
                                onClick={() => {
                                  togglePhqExpanded(idKey);
                                }}
                                className="px-3 py-1 rounded bg-blue-600 text-white text-sm"
                                type="button"
                              >
                                {isExpanded ? "Hide details" : "Details"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="my-2">
                  <h4 className="text-sm font-semibold">Resource engagement</h4>
                  {detailsLoading ? (
                    <p className="text-sm text-gray-500">Loading...</p>
                  ) : resourceSearches && resourceSearches.length > 0 ? (
                    <div className="space-y-2">
                      {(resourceSearches || [])
                        .slice()
                        .sort((a, b) => {
                          const aTs = parseToMs(
                            a.timestamp ||
                              a.createdAt ||
                              a.created_at ||
                              a.time ||
                              a.date
                          );
                          const bTs = parseToMs(
                            b.timestamp ||
                              b.createdAt ||
                              b.created_at ||
                              b.time ||
                              b.date
                          );
                          return (bTs || 0) - (aTs || 0); // newest first
                        })
                        .map((r, idx) => {
                          const q =
                            r.query ||
                            r.search_query ||
                            r.term ||
                            r.queryText ||
                            r.text ||
                            "(search)";
                          const ts =
                            r.timestamp ||
                            r.createdAt ||
                            r.created_at ||
                            r.time ||
                            r.date ||
                            null;
                          return (
                            <div
                              key={r.id || idx}
                              className="bg-gray-50 border rounded-lg p-3"
                            >
                              <div className="flex items-center justify-between mb-1">
                                <div className="text-sm text-gray-800 truncate">
                                  {q}
                                </div>
                                <div className="text-xs text-gray-500">
                                  {ts ? formatDateOnly(ts) : "Unknown"}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      No resource search activity for this user.
                    </p>
                  )}
                </div>

                <div className="my-2">
                  <h4 className="text-sm font-semibold">
                    Chatbot history (500‑word summary)
                  </h4>
                  {detailsLoading ? (
                    <p className="text-sm text-gray-500">Loading...</p>
                  ) : userChatHistory && userChatHistory.length > 0 ? (
                    <div className="space-y-2">
                      {/* Render a deterministic extractive summary of the chat history */}
                      <ChatSummaryBlock
                        email={activeAppointment?.email}
                        messages={userChatHistory}
                      />
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">
                      No chat history found for this user.
                    </p>
                  )}
                </div>
              </div>

              {/* Generate Report Button */}
              <div className="flex justify-between gap-4 sticky bottom-0 left-0 right-0 bg-white p-4 border-t z-10">
                <div className="flex items-center gap-2">
                  <button
                    onClick={async () => {
                      if (!activeAppointment) return;
                      setReportLoading(true);
                      try {
                        // Convert various section data into plain text payloads
                        const prepareText = (data, section) => {
                          if (!data) return "";
                          if (typeof data === "string") return data;
                          if (Array.isArray(data)) {
                            if (section === "chat") {
                              return data
                                .map(
                                  (m) =>
                                    `${m.role || m.from || "unknown"}: ${
                                      m.content || m.text || m.message || ""
                                    }`
                                )
                                .join("\n");
                            }
                            if (section === "peer") {
                              return data
                                .map(
                                  (p) => `${p.title || ""}\n${p.content || ""}`
                                )
                                .join("\n\n");
                            }
                            if (section === "resources") {
                              return data
                                .map(
                                  (r) =>
                                    `${r.title || ""} (${r.type || ""}) - ${
                                      r.language || ""
                                    }`
                                )
                                .join("\n");
                            }
                            if (section === "phq9") {
                              return data
                                .map(
                                  (p) =>
                                    `Date: ${
                                      p.timestamp || p.submittedAt || ""
                                    } Score: ${
                                      p.total_score || p.totalScore || ""
                                    } Answers: ${(p.answers || []).join(", ")}`
                                )
                                .join("\n");
                            }
                            return JSON.stringify(data);
                          }
                          return String(data);
                        };

                        const chatText = prepareText(
                          (userChatHistory || []).map((msg) => ({
                            role: msg.from || msg.role || "unknown",
                            content:
                              msg.text || msg.message || msg.content || "",
                          })),
                          "chat"
                        );

                        // Peer/forum activity removed from report generation

                        // Combine server-suggested resources and the user's own resource searches
                        const combinedResources = [];
                        // server-provided resources
                        (userResources || []).forEach((res) =>
                          combinedResources.push({
                            title: res.title || res.name || "",
                            type: res.type || "resource",
                            language: res.language || "English",
                          })
                        );
                        // user resource searches (engagement)
                        (resourceSearches || []).forEach((s) => {
                          const q =
                            s.query ||
                            s.search_query ||
                            s.term ||
                            s.text ||
                            s.queryText ||
                            "(search)";
                          const ts =
                            s.timestamp ||
                            s.createdAt ||
                            s.created_at ||
                            s.time ||
                            s.date ||
                            null;
                          combinedResources.push({
                            title: `${q}${
                              ts ? ` — ${formatDateOnly(ts)}` : ""
                            }`,
                            type: "search",
                            language: "",
                          });
                        });

                        const resourcesText = prepareText(
                          combinedResources,
                          "resources"
                        );

                        const phqText = prepareText(
                          (activePhqEntries || []).map((entry) => ({
                            timestamp:
                              entry.timestamp || entry.submittedAt || "",
                            total_score:
                              entry.total_score || entry.totalScore || 0,
                            answers: entry.answers || [],
                          })),
                          "phq9"
                        );

                        const defaultPoints = Array.from(
                          { length: 5 },
                          () => "No data available for analysis."
                        );

                        const callSummarize = async (text, sectionName) => {
                          if (!text || String(text).trim().length === 0)
                            return { points: defaultPoints };
                          try {
                            const res = await fetch(
                              `${BACKEND}/api/summarize`,
                              {
                                method: "POST",
                                headers: summarizeHeadersBase || {
                                  "Content-Type": "application/json",
                                },
                                body: JSON.stringify({
                                  text,
                                  section: sectionName,
                                }),
                              }
                            );
                            if (!res.ok) return { points: defaultPoints };
                            const body = await res.json();
                            return {
                              points:
                                Array.isArray(body.points) && body.points.length
                                  ? body.points
                                  : defaultPoints,
                            };
                          } catch (e) {
                            console.warn(
                              `Summary fetch failed for ${sectionName}`,
                              e
                            );
                            return { points: defaultPoints };
                          }
                        };

                        const [chatSummary, resourceSummary, phqSummary] =
                          await Promise.all([
                            callSummarize(chatText, "chat"),
                            callSummarize(resourcesText, "resources"),
                            callSummarize(phqText, "phq9"),
                          ]);

                        setSections({
                          chatHistory: chatSummary.points || [],
                          resources: resourceSummary.points || [],
                          phq9: phqSummary.points || [],
                        });

                        const defaultMessage =
                          "No data available for analysis.";
                        const formatSection = (points) =>
                          points && points.length > 0
                            ? points.map((p) => `- ${p}`).join("\n")
                            : `- ${defaultMessage}`;

                        const report = `
# Client Report: ${activeAppointment.userName || "Client"}

## Basic Information
- **Name:** ${activeAppointment.userName || "Not provided"}
- **Email:** ${activeAppointment.email || "Not provided"}
- **Contact:** ${activeAppointment.contact || "Not provided"}
- **Appointment Date:** ${
                          activeAppointment.time
                            ? new Date(activeAppointment.time).toLocaleString()
                            : "Not scheduled"
                        }
- **Status:** ${activeAppointment.status || "Unknown"}

## Chat History Analysis
${formatSection(chatSummary.points)}


## Resource Engagement
${formatSection(resourceSummary.points)}

## PHQ-9 Screening Summary
${formatSection(phqSummary.points)}
`;

                        setReportMarkdown(report);
                        setShowReportPreview(true);
                      } catch (e) {
                        console.error("Report generation failed", e);
                        const errorMessage =
                          e?.message || "An unexpected error occurred";
                        const friendlyMessage = errorMessage.startsWith(
                          "Failed to fetch"
                        )
                          ? "Unable to connect to the server. Please check your internet connection and try again."
                          : `Report generation failed: ${errorMessage}`;
                        alert(friendlyMessage);
                      } finally {
                        setReportLoading(false);
                      }
                    }}
                    className={`px-3 py-2 rounded ${
                      reportLoading ? "bg-indigo-300" : "bg-indigo-600"
                    } text-white flex items-center justify-center gap-2`}
                    disabled={reportLoading}
                  >
                    {reportLoading ? (
                      <span className="flex items-center gap-2">
                        <svg
                          className="animate-spin h-4 w-4"
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
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8z"
                          ></path>
                        </svg>{" "}
                        Generating...
                      </span>
                    ) : (
                      "Generate Report"
                    )}
                  </button>
                  {showReportPreview && (
                    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4">
                      <div
                        className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-y-auto z-40"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center justify-between sticky top-0 left-0 right-0 bg-white p-4 border-b z-10">
                          <h3 className="text-lg font-semibold">
                            Report Preview
                          </h3>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={async () => {
                                // Render the report preview (Markdown) to an offscreen DOM node
                                // then convert to PDF using html2canvas + jsPDF so styling is preserved.
                                try {
                                  const mdToRender = reportMarkdown || "";
                                  const { jsPDF } = await import("jspdf");
                                  const html2canvasModule = await import(
                                    "html2canvas"
                                  );
                                  const html2canvas =
                                    html2canvasModule.default ||
                                    html2canvasModule;

                                  // Helper to escape HTML when rendering plain text fallback
                                  const escapeHtml = (str) =>
                                    String(str)
                                      .replace(/&/g, "&amp;")
                                      .replace(/</g, "&lt;")
                                      .replace(/>/g, "&gt;")
                                      .replace(/"/g, "&quot;")
                                      .replace(/'/g, "&#039;");

                                  // Create offscreen container
                                  const container =
                                    document.createElement("div");
                                  container.style.position = "fixed";
                                  container.style.left = "-10000px";
                                  container.style.top = "0";
                                  // Use a width that approximates A4 at 96dpi (about 794px) so layout is predictable
                                  container.style.width = "794px";
                                  container.style.padding = "20px";
                                  container.style.background = "white";
                                  container.style.boxSizing = "border-box";
                                  container.style.color = "#111827"; // text-gray-900
                                  container.style.fontFamily =
                                    'Inter, ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';

                                  let appended = false;

                                  // Try to render using the same Markdown component for best fidelity
                                  if (MarkdownComponent && remarkGfmPlugin) {
                                    try {
                                      // Dynamically import React DOM client to render into the container
                                      const ReactDOM = await import(
                                        "react-dom/client"
                                      );
                                      const root =
                                        ReactDOM.createRoot(container);
                                      const el = React.createElement(
                                        MarkdownComponent,
                                        { remarkPlugins: [remarkGfmPlugin] },
                                        mdToRender
                                      );
                                      root.render(el);
                                      document.body.appendChild(container);
                                      appended = true;
                                      // Give the browser a moment to render fonts/images/styles
                                      await new Promise((r) =>
                                        setTimeout(r, 300)
                                      );

                                      // Render to canvas
                                      const canvas = await html2canvas(
                                        container,
                                        {
                                          scale: 2,
                                          useCORS: true,
                                          backgroundColor: "#ffffff",
                                        }
                                      );

                                      // Cleanup React root
                                      try {
                                        root.unmount();
                                      } catch (_) {}
                                      if (appended)
                                        document.body.removeChild(container);

                                      // Paginate canvas into PDF pages
                                      const pdf = new jsPDF("p", "pt", "a4");
                                      const pdfWidth =
                                        pdf.internal.pageSize.getWidth();
                                      const pdfHeight =
                                        pdf.internal.pageSize.getHeight();

                                      const imgWidth = canvas.width;
                                      const imgHeight = canvas.height;
                                      // height of one PDF page in canvas pixels
                                      const pageHeightPx = Math.floor(
                                        (imgWidth * pdfHeight) / pdfWidth
                                      );

                                      let y = 0;
                                      let pageCount = 0;
                                      while (y < imgHeight) {
                                        const sliceHeight = Math.min(
                                          pageHeightPx,
                                          imgHeight - y
                                        );
                                        const pageCanvas =
                                          document.createElement("canvas");
                                        pageCanvas.width = imgWidth;
                                        pageCanvas.height = sliceHeight;
                                        const ctx = pageCanvas.getContext("2d");
                                        ctx.drawImage(
                                          canvas,
                                          0,
                                          y,
                                          imgWidth,
                                          sliceHeight,
                                          0,
                                          0,
                                          imgWidth,
                                          sliceHeight
                                        );
                                        const imgData =
                                          pageCanvas.toDataURL("image/png");

                                        const imgPdfHeight =
                                          (sliceHeight * pdfWidth) / imgWidth;
                                        if (pageCount > 0) pdf.addPage();
                                        pdf.addImage(
                                          imgData,
                                          "PNG",
                                          0,
                                          0,
                                          pdfWidth,
                                          imgPdfHeight
                                        );
                                        y += sliceHeight;
                                        pageCount += 1;
                                      }

                                      const filename = `${(
                                        activeAppointment.userName || "report"
                                      ).replace(/\s+/g, "_")}_report.pdf`;
                                      pdf.save(filename);
                                      return;
                                    } catch (innerErr) {
                                      console.warn(
                                        "MarkdownComponent render failed, falling back to plain text PDF",
                                        innerErr
                                      );
                                      try {
                                        if (appended)
                                          document.body.removeChild(container);
                                      } catch (_) {}
                                    }
                                  }

                                  // Fallback: render plain markdown text into the container
                                  container.innerHTML = `<div style="white-space:pre-wrap; font-size:12px; line-height:1.4;">${escapeHtml(
                                    mdToRender
                                  )}</div>`;
                                  document.body.appendChild(container);
                                  // allow layout
                                  await new Promise((r) => setTimeout(r, 150));
                                  const canvas2 = await html2canvas(container, {
                                    scale: 2,
                                    useCORS: true,
                                    backgroundColor: "#ffffff",
                                  });
                                  if (appended)
                                    try {
                                      document.body.removeChild(container);
                                    } catch (_) {}

                                  const pdf2 = new jsPDF("p", "pt", "a4");
                                  const pdfWidth2 =
                                    pdf2.internal.pageSize.getWidth();
                                  const pdfHeight2 =
                                    pdf2.internal.pageSize.getHeight();
                                  const imgW = canvas2.width;
                                  const imgH = canvas2.height;
                                  const pageHpx = Math.floor(
                                    (imgW * pdfHeight2) / pdfWidth2
                                  );
                                  let yy = 0;
                                  let pc = 0;
                                  while (yy < imgH) {
                                    const sh = Math.min(pageHpx, imgH - yy);
                                    const pcv =
                                      document.createElement("canvas");
                                    pcv.width = imgW;
                                    pcv.height = sh;
                                    const ctx2 = pcv.getContext("2d");
                                    ctx2.drawImage(
                                      canvas2,
                                      0,
                                      yy,
                                      imgW,
                                      sh,
                                      0,
                                      0,
                                      imgW,
                                      sh
                                    );
                                    const id = pcv.toDataURL("image/png");
                                    const imgPdfH = (sh * pdfWidth2) / imgW;
                                    if (pc > 0) pdf2.addPage();
                                    pdf2.addImage(
                                      id,
                                      "PNG",
                                      0,
                                      0,
                                      pdfWidth2,
                                      imgPdfH
                                    );
                                    yy += sh;
                                    pc += 1;
                                  }
                                  const filename2 = `${(
                                    activeAppointment.userName || "report"
                                  ).replace(/\s+/g, "_")}_report.pdf`;
                                  pdf2.save(filename2);
                                } catch (e) {
                                  console.error("Download failed", e);
                                  alert(
                                    "Download failed: " + (e?.message || e)
                                  );
                                }
                              }}
                              className="px-3 py-1 rounded bg-green-600 text-white"
                            >
                              Download PDF
                            </button>
                            <button
                              onClick={() => {
                                setShowReportPreview(false);
                                setReportMarkdown("");
                              }}
                              className="px-3 py-1 rounded bg-gray-100"
                            >
                              Close
                            </button>
                          </div>
                        </div>
                        <div className=" flex flex-col m-2 border rounded p-2 bg-white prose prose-sm gap-2">
                          {MarkdownComponent && remarkGfmPlugin ? (
                            <MarkdownComponent
                              remarkPlugins={[remarkGfmPlugin]}
                            >
                              {reportMarkdown}
                            </MarkdownComponent>
                          ) : mdLoadError ? (
                            <div className="text-sm text-gray-500 whitespace-pre-wrap font-mono m-2 p-2">
                              {reportMarkdown || "No preview available."}
                            </div>
                          ) : (
                            <div className="text-sm text-gray-500">
                              Loading preview renderer...
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// Helper: fetch resources, chat history and peer posts for a given user email
async function fetchJsonSafe(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) {
    return null;
  }
}

async function loadDetailsForUser(
  email,
  appt,
  options = { fetchResources: true, fetchPosts: true }
) {
  // This file-level helper will be imported by the component via closure. Use backend BASE from window if necessary.
  const base = typeof API !== "undefined" ? API : "";
  // set loading
  try {
    // attempt to get suggested/local resources (only if allowed)
    let resourcesList = [];
    if (options.fetchResources) {
      const resourcesRes = await fetchJsonSafe(`${base}/api/resources`);
      resourcesList = (resourcesRes && resourcesRes.resources) || [];
    }

    // Attempt to fetch the user's resource search history (optional endpoint)
    // The server may not implement this; fetchJsonSafe will return null on 404/err
    let resourceSearches = [];
    if (email) {
      try {
        const searchesRes = await fetchJsonSafe(
          `${base}/api/resource-searches?email=${encodeURIComponent(email)}`
        );
        // expect array of { query?: string, timestamp?: string|number }
        resourceSearches = Array.isArray(searchesRes)
          ? searchesRes
          : (searchesRes && searchesRes.searches) || [];
      } catch (e) {
        resourceSearches = [];
      }
    }

    // chat sessions by email - fetch messages for each session and preserve session metadata
    let chatMsgs = [];
    if (email) {
      const sessionsRes = await fetchJsonSafe(
        `${base}/api/chat/session?email=${encodeURIComponent(email)}`
      );
      const sessions = (sessionsRes && sessionsRes.sessions) || [];
      if (sessions.length > 0) {
        // fetch messages for each session (preserve order returned by backend)
        const sessionPromises = sessions.map(async (s) => {
          const sid = s.id;
          const msgsRes = await fetchJsonSafe(
            `${base}/api/chat/session/${encodeURIComponent(
              sid
            )}/messages?email=${encodeURIComponent(email)}`
          );
          const msgs = (msgsRes && msgsRes.messages) || msgsRes || [];
          return { sessionId: sid, session: s, messages: msgs };
        });
        chatMsgs = await Promise.all(sessionPromises);
      }
    }

    // peer/forum posts were removed from counsellor view - do not fetch posts here
    let posts = [];

    // Update state in the component via the global window - find React hook setters
    try {
      // we assume the component setUserResources etc are in scope; fall back to window update via event
      // Using a custom DOM event to deliver the loaded data to the component instance
      window.dispatchEvent(
        new CustomEvent("mindsphere:detailsLoaded", {
          detail: { resourcesList, chatMsgs, resourceSearches },
        })
      );
    } catch (e) {
      console.warn("Could not dispatch details event", e);
    }
  } catch (e) {
    console.warn("loadDetailsForUser failed", e);
  }
}

export default CounsellorDashboard;

// Small deterministic extractive summarizer component for chat history (client-side)
function ChatSummaryBlock({ messages, email }) {
  // messages: array of session objects { sessionId, session, messages: [...] }
  // email: optional string; when provided we ask backend to aggregate all sessions for this email
  const [summaryText, setSummaryText] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let mounted = true;
    const base = typeof API !== "undefined" ? API : "";

    const flattenMessages = (sessions) => {
      const all = [];
      for (const s of sessions || []) {
        if (s && Array.isArray(s.messages)) {
          for (const m of s.messages) {
            all.push(m);
          }
        } else if (s && (s.text || s.message || s.content)) {
          all.push(s);
        }
      }
      return all;
    };

    // Read an optional dev/admin token from Vite env. If set, include it as a Bearer token
    // so the backend can verify caller identity when ADMIN_SUMMARY_TOKEN is enabled.
    const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_SUMMARY_TOKEN;
    const defaultHeaders = { "Content-Type": "application/json" };
    if (ADMIN_TOKEN) defaultHeaders["Authorization"] = `Bearer ${ADMIN_TOKEN}`;
    (async () => {
      setError(null);
      setSummaryText(null);

      const hasMsgs = Array.isArray(messages) && messages.length > 0;
      if (!hasMsgs && !email) return;
      setLoading(true);
      try {
        let payload = null;

        if (email && typeof email === "string") {
          // Ask server to aggregate all sessions/messages for this email.
          payload = { email };
        } else {
          // Client-side flattened messages fallback
          const allMsgs = flattenMessages(messages || []);
          // Keep a small local cap to avoid huge payloads
          const capped = allMsgs.slice(-200);
          // convert to minimal shape expected by server
          payload = {
            messages: capped.map((m) => ({
              text: m?.text || m?.message || m?.content || "",
            })),
          };
        }

        const res = await fetch(base + "/api/chat/summary", {
          method: "POST",
          headers: { ...defaultHeaders },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const txt = await res.text().catch(() => "");
          throw new Error(`Server error ${res.status}: ${txt}`);
        }

        const body = await res.json();
        let gotSummary = false;
        if (mounted && body && typeof body.summary === "string") {
          setSummaryText(body.summary.trim());
          gotSummary = true;
        }

        // If server returned nothing, fall back to extractive
        // Only run the extractive fallback if server did not already provide a summary
        if (!gotSummary) {
          const flat = flattenMessages(messages || [])
            .map((m) => m?.text || m?.message || m?.content || "")
            .filter(Boolean);
          const joined = flat.join("\n");
          const fallback = (joined.split(/(?<=[.!?])\s+/) || [])
            .slice(0, 3)
            .join(" ");
          if (mounted) setSummaryText(fallback || "No chat content available.");
        }
      } catch (err) {
        if (!mounted) return;
        setError(err?.message || String(err));
        // fallback: small excerpt from messages
        try {
          const flat = flattenMessages(messages || [])
            .map((m) => m?.text || m?.message || m?.content || "")
            .filter(Boolean)
            .slice(-6);
          setSummaryText(flat.join("\n") || "No chat content available.");
        } catch (e) {
          setSummaryText("No chat content available.");
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [messages, email]);

  if (loading)
    return (
      <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded">
        Generating summary...
      </div>
    );
  if (!summaryText)
    return (
      <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded">
        No chat content available.
      </div>
    );

  return (
    <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded whitespace-pre-wrap">
      {summaryText}
      {error && (
        <div className="mt-2 text-xs text-red-500">
          Summary fallback: {error}
        </div>
      )}
    </div>
  );
}
