import React, { useState, useEffect } from "react";
import { User, Mail, Phone, Calendar, Users, Edit3, Save, X, Loader } from "lucide-react";
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

  useEffect(() => {
    const unsubscribe = onAuthChange(async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        await loadUserProfile(currentUser.uid);
      } else {
        setUser(null);
        setDataLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadUserProfile = async (uid) => {
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
        setHasProfile(false);
        setIsEditing(true);
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

      setOriginalForm(form);
      setIsEditing(false);
      setHasProfile(true);
      setErrors({});
    } catch (err) {
      console.error("Failed to save profile:", err);
      setErrors({ general: "Failed to save profile. Please try again." });
    }
    setLoading(false);
  };

  const validateForm = () => {
    const newErrors = {};
    if (!form.name.trim()) newErrors.name = "Name is required";
    if (!form.phone.trim()) newErrors.phone = "Phone is required";
    else if (!/^\d{10}$/.test(form.phone.replace(/\D/g, "")))
      newErrors.phone = "Invalid 10-digit phone number";
    if (!form.age) newErrors.age = "Age is required";
    else if (parseInt(form.age) < 16) newErrors.age = "Must be at least 16";
    else if (parseInt(form.age) > 120) newErrors.age = "Invalid age";
    if (!form.gender) newErrors.gender = "Gender is required";
    if (!form.school.trim()) newErrors.school = "School/College is required";
    if (!form.address.trim()) newErrors.address = "Address is required";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    if (errors[name]) setErrors({ ...errors, [name]: "" });
  };

  const handleCancel = () => {
    setIsEditing(false);
    setForm(originalForm);
    setErrors({});
  };

  if (dataLoading)
    return <Loader className="w-10 h-10 animate-spin mx-auto mt-24 text-[#263238]" />;

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
            <User className="w-20 h-20 text-[#263238] p-2 bg-white rounded-full shadow-lg" />
          </div>
          <h1 className="text-3xl font-bold text-[#263238] mb-1">My Profile</h1>
          <p className="text-gray-600">
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
        </div>

        {errors.general && <p className="text-red-500 mb-4">{errors.general}</p>}

        {/* Profile Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 transition-transform hover:scale-105">
          {(!hasProfile || isEditing) ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[
                  { label: "Full Name", name: "name", type: "text", icon: <User className="w-4 h-4 inline mr-1" /> },
                  { label: "Email", name: "email", type: "email", value: user.email, disabled: true, icon: <Mail className="w-4 h-4 inline mr-1" /> },
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
                <button onClick={handleCancel} className="px-6 py-2 border rounded-lg hover:bg-gray-100 transition transform hover:scale-105">
                  Cancel
                </button>
                <button
                  onClick={saveProfileToFirebase}
                  className="px-6 py-2 bg-[#263238] text-white rounded-lg hover:bg-gray-800 flex items-center gap-2 transition transform hover:scale-105"
                >
                  {loading ? <Loader className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-[#263238]">
                <p><strong>Full Name:</strong> {form.name}</p>
                <p><strong>Email:</strong> {user.email}</p>
                <p><strong>Phone:</strong> {form.phone}</p>
                <p><strong>Age:</strong> {form.age}</p>
                <p><strong>School:</strong> {form.school}</p>
                <p><strong>Gender:</strong> {form.gender}</p>
                <p className="md:col-span-2"><strong>Address:</strong> {form.address}</p>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={() => setIsEditing(true)}
                  className="px-6 py-2 bg-[#263238] text-white rounded-lg hover:bg-gray-800 flex items-center gap-2 transition transform hover:scale-105"
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
