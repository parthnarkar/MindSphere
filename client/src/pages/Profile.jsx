import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { User, Mail, Phone, Calendar, Users, Edit3, Save, X, Loader } from "lucide-react";
import LogoLoader from "../components/LogoLoader";
import { db } from "../firebase.js";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { onAuthChange } from "../services/auth.js";

export default function Profile() {

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    age: "",
    gender: "",
    school: "",
    address: "",
  });
  const [originalForm, setOriginalForm] = useState({});
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [hasProfile, setHasProfile] = useState(false);
  const [errors, setErrors] = useState({});
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsubscribe = onAuthChange(async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        // Ensure email is prefilled for new profiles
        try { setForm((f) => ({ ...f, email: currentUser.email || "" })); } catch(e){}
        await loadUserProfile(currentUser.uid, currentUser);
      } else {
        setUser(null);
        setDataLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadUserProfile = async (uid, authUser = null) => {
    try {
      setDataLoading(true);
      const docRef = doc(db, "profiles", uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const userData = docSnap.data();
        setForm(userData);
        setOriginalForm(userData);
        setHasProfile(true);
        setIsEditing(false);
      } else {
        // No Firestore profile: show whatever auth data is present in view mode
        setHasProfile(false);
        const prefill = {
          name: (authUser && authUser.displayName) || "",
          email: (authUser && authUser.email) || "",
          phone: "",
          age: "",
          gender: "",
          school: "",
          address: "",
        };
        setForm(prefill);
        setOriginalForm(prefill);
        setIsEditing(false);
      }
      setDataLoading(false);
    } catch (err) {
      console.error("Failed to load profile:", err);
      setDataLoading(false);
    }
  };

  const saveProfileToFirebase = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const docRef = doc(db, "profiles", user.uid);
      await setDoc(
        docRef,
        {
          ...form,
          updatedAt: new Date(),
          createdAt: hasProfile ? originalForm.createdAt : new Date(),
        },
        { merge: true }
      );

      // Reload saved profile to ensure canonical data (timestamps, server values)
      await loadUserProfile(user.uid);
      setErrors({});
    } catch (err) {
      console.error("Failed to save profile:", err);
      setErrors({ general: "Failed to save profile. Please try again." });
    }
    setLoading(false);
  };

  const validateForm = () => {
    // Make all fields optional. Only validate formats when values are present.
    const newErrors = {};
    // Phone: coerce to string safely before trimming; allow numbers/null/undefined from Firestore
    const rawPhone = form.phone ?? "";
    const phoneStr = typeof rawPhone === "string" ? rawPhone : String(rawPhone);
    if (phoneStr.trim()) {
      const digits = phoneStr.replace(/\D/g, "");
      if (!/^\d{10}$/.test(digits)) newErrors.phone = "Invalid 10-digit phone number";
    }
    // Age: validate only when a value is present (string or number)
    if (form.age !== undefined && form.age !== null && String(form.age).trim() !== "") {
      const ageNum = parseInt(form.age, 10);
      if (Number.isNaN(ageNum) || ageNum < 1 || ageNum > 120) newErrors.age = "Invalid age";
    }
    // No other required validations
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    if (errors[name]) setErrors({ ...errors, [name]: "" });
  };

  const handleCancel = () => {
    // Revert edits and return to read-only view on the same /profile page
    setIsEditing(false);
    // Restore last saved/original values if present, otherwise fall back to auth-provided email
    setForm(
      originalForm && Object.keys(originalForm).length
        ? originalForm
        : {
            name: "",
            email: user?.email || "",
            phone: "",
            age: "",
            gender: "",
            school: "",
            address: "",
          }
    );
    // keep originalForm intact so future edits can still revert
    setErrors({});
    // do not navigate away; stay on /profile
  };

  if (dataLoading)
    return <LogoLoader active={true} minDuration={2000} size={80} />;

  // notify app that the profile page is fully rendered
  try { window.dispatchEvent(new CustomEvent('mindsphere:pageReady')); } catch(e) {}

  if (!user)
    return (
      <p className="text-center mt-24 text-[#263238] text-lg font-medium">
        Please sign in to view your profile
      </p>
    );

  return (
    <div className="min-h-screen p-6" style={{ backgroundColor: "#FAF3EF" }}>
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            {user?.photoURL ? (
              <img
                src={user.photoURL}
                alt="Profile"
                className="w-20 h-20 rounded-full object-cover shadow-lg"
                onError={(e) => { e.currentTarget.onerror = null; e.currentTarget.src = '/mindsphere-logo.png'; }}
              />
            ) : (
              <User className="w-20 h-20 text-[#263238] p-2 bg-white rounded-full shadow-lg" />
            )}
          </div>
          <h1 className="text-3xl font-bold text-[#263238] mb-1">My Profile</h1>
          <p className="text-gray-600">
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
        </div>

        {errors.general && <p className="text-red-500 mb-4">{errors.general}</p>}

        {/* Profile Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 transition-transform">
          {isEditing ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { label: "Email", name: "email", type: "email", value: user.email, disabled: true, icon: <Mail className="w-4 h-4 inline mr-1" /> },
                  { label: "Full Name", name: "name", type: "text", icon: <User className="w-4 h-4 inline mr-1" /> },
                  { label: "Phone", name: "phone", type: "tel", icon: <Phone className="w-4 h-4 inline mr-1" /> },
                  { label: "Age", name: "age", type: "number", icon: <Calendar className="w-4 h-4 inline mr-1" /> },
                  { label: "School/College", name: "school", type: "text", icon: <Users className="w-4 h-4 inline mr-1" /> },
                  { label: "Gender", name: "gender", type: "select", options: ["Male", "Female", "Other", "Prefer not to say"], icon: <User className="w-4 h-4 inline mr-1" /> },
                ].map((field, idx) => (
                  <div key={idx}>
                    <label className="font-semibold text-gray-700 flex items-center gap-1">
                      {field.icon} {field.label}
                    </label>
                    {field.type === "select" ? (
                      <select
                        name={field.name}
                        value={form[field.name]}
                        onChange={handleChange}
                        className="w-full border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-[#263238]"
                      >
                        <option value="">Select {field.label}</option>
                        {field.options.map((opt, i) => (
                          <option key={i} value={opt.toLowerCase()}>{opt}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={field.type}
                        name={field.name}
                        value={field.value || form[field.name]}
                        onChange={handleChange}
                        disabled={field.disabled}
                        className={`w-full border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-[#263238] ${field.disabled ? "bg-gray-200 cursor-not-allowed" : ""}`}
                      />
                    )}
                    {errors[field.name] && (
                      <p className="text-red-500 text-sm mt-1">{errors[field.name]}</p>
                    )}
                  </div>
                ))}
                <div className="md:col-span-2">
                  <label className="font-semibold text-gray-700 flex items-center gap-1">
                    <User className="w-4 h-4 inline mr-1" /> Address
                  </label>
                  <textarea
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    className="w-full border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-[#263238]"
                    rows="3"
                  />
                  {errors.address && <p className="text-red-500 text-sm mt-1">{errors.address}</p>}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-4">
                <button onClick={handleCancel} className="px-6 py-2 border rounded-lg hover:bg-gray-100 transition transform" disabled={loading}>
                  Cancel
                </button>
                <button
                  onClick={saveProfileToFirebase}
                  className="px-6 py-2 bg-[#263238] text-white rounded-lg hover:bg-gray-800 flex items-center gap-2 transition transform"
                  disabled={loading}
                >
                  {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-[#263238]">
                <p><strong>Email:</strong> {user.email}</p>
                <p><strong>Full Name:</strong> {form.name}</p>
                <p><strong>Phone:</strong> {form.phone}</p>
                <p><strong>Age:</strong> {form.age}</p>
                <p><strong>School:</strong> {form.school}</p>
                <p><strong>Gender:</strong> {form.gender}</p>
                <p className="md:col-span-2"><strong>Address:</strong> {form.address}</p>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-6 py-2 bg-[#263238] text-white rounded-lg hover:bg-gray-800 flex items-center gap-2 transition transform"
                >
                  <Edit3 className="w-4 h-4" /> Edit Profile
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
