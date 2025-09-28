import React, { useState, useEffect } from "react";
import { User, MapPin, Edit3, Save, Loader, BookOpen, Calendar, FileText } from "lucide-react";
import { db } from "../firebase.js";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { onAuthChange } from "../services/auth.js";

export default function CounsellorProfile() {
  const [form, setForm] = useState({
    name: "",
    experience: "",
    address: "",
    age: "",
    description: "",
    role: "counsellor",
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
        await loadProfile(currentUser.uid);
      } else {
        setUser(null);
        setDataLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  const loadProfile = async (uid) => {
    try {
      setDataLoading(true);
      const docRef = doc(db, "counsellors", uid);
      const docSnap = await getDoc(docRef);

      if (docSnap.exists()) {
        const data = docSnap.data();
        setForm(data);
        setOriginalForm(data);
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

  const validateForm = () => {
    const newErrors = {};
    if (!form.name.trim()) newErrors.name = "Name is required";
    if (!form.experience.trim()) newErrors.experience = "Experience is required";
    if (!form.address.trim()) newErrors.address = "Address is required";
    if (!form.age.trim()) newErrors.age = "Age is required";
    if (!form.description.trim()) newErrors.description = "Description is required";

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const saveProfile = async () => {
    if (!validateForm()) return;

    setLoading(true);
    try {
      const docRef = doc(db, "counsellors", user.uid);
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
      setHasProfile(true);
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to save profile:", err);
    }
    setLoading(false);
  };

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    if (errors[name]) setErrors({ ...errors, [name]: "" });
  };

  const handleCancel = () => {
    setForm(originalForm);
    setIsEditing(false);
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
          <h1 className="text-3xl font-bold text-[#263238] mb-1">Counsellor Profile</h1>
          <p className="text-gray-600">
            Signed in as <span className="font-medium">{user.email}</span>
          </p>
        </div>

        {/* Profile Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 transition-transform hover:scale-105">
          {!hasProfile || isEditing ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="font-semibold text-gray-700 flex items-center gap-1">
                    <User className="w-4 h-4" /> Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className="w-full border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-[#263238]"
                  />
                  {errors.name && <p className="text-red-500 text-sm">{errors.name}</p>}
                </div>

                <div>
                  <label className="font-semibold text-gray-700 flex items-center gap-1">
                    <Calendar className="w-4 h-4" /> Age
                  </label>
                  <input
                    type="number"
                    name="age"
                    value={form.age}
                    onChange={handleChange}
                    className="w-full border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-[#263238]"
                  />
                  {errors.age && <p className="text-red-500 text-sm">{errors.age}</p>}
                </div>

                <div>
                  <label className="font-semibold text-gray-700 flex items-center gap-1">
                    <BookOpen className="w-4 h-4" /> Experience
                  </label>
                  <input
                    type="text"
                    name="experience"
                    value={form.experience}
                    onChange={handleChange}
                    className="w-full border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-[#263238]"
                  />
                  {errors.experience && <p className="text-red-500 text-sm">{errors.experience}</p>}
                </div>

                <div>
                  <label className="font-semibold text-gray-700 flex items-center gap-1">
                    <MapPin className="w-4 h-4" /> Address
                  </label>
                  <input
                    type="text"
                    name="address"
                    value={form.address}
                    onChange={handleChange}
                    className="w-full border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-[#263238]"
                  />
                  {errors.address && <p className="text-red-500 text-sm">{errors.address}</p>}
                </div>

                <div className="md:col-span-2">
                  <label className="font-semibold text-gray-700 flex items-center gap-1">
                    <FileText className="w-4 h-4" /> Description
                  </label>
                  <textarea
                    name="description"
                    value={form.description}
                    onChange={handleChange}
                    rows="4"
                    className="w-full border rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-[#263238]"
                  />
                  {errors.description && <p className="text-red-500 text-sm">{errors.description}</p>}
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-4">
                <button
                  onClick={handleCancel}
                  className="px-6 py-2 border rounded-lg hover:bg-gray-100 transition transform hover:scale-105"
                >
                  Cancel
                </button>
                <button
                  onClick={saveProfile}
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
                <p><strong>Name:</strong> {form.name}</p>
                <p><strong>Age:</strong> {form.age}</p>
                <p><strong>Experience:</strong> {form.experience}</p>
                <p><strong>Address:</strong> {form.address}</p>
                <p className="md:col-span-2"><strong>Description:</strong> {form.description}</p>
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
