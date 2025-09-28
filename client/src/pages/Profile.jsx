import React, { useState, useEffect } from "react";
import { User, Mail, Phone, Calendar, Users, Edit3, Save, X, AlertCircle, GraduationCap, MapPin } from "lucide-react";

export default function Profile() {
  const [form, setForm] = useState({
    name: "Anshul Patil",
    email: "test0@gmail.com",
    phone: "9324611189",
    age: "18",
    gender: "male",
    school: "Mumbai University",
    address: "123 Main Street, Andheri West, Mumbai, Maharashtra 400058",
  });
  const [loading, setLoading] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [hasProfile, setHasProfile] = useState(true);
  const [errors, setErrors] = useState({});

  // Validate form
  const validateForm = () => {
    const newErrors = {};
    
    if (!form.name.trim()) {
      newErrors.name = "Name is required";
    }
    
    if (!form.phone.trim()) {
      newErrors.phone = "Phone number is required";
    }
    
    if (!form.age) {
      newErrors.age = "Age is required";
    } else if (parseInt(form.age) < 16) {
      newErrors.age = "You must be at least 16 years old";
    } else if (parseInt(form.age) > 120) {
      newErrors.age = "Please enter a valid age";
    }
    
    if (!form.gender) {
      newErrors.gender = "Gender is required";
    }
    
    if (!form.school.trim()) {
      newErrors.school = "School/College name is required";
    }
    
    if (!form.address.trim()) {
      newErrors.address = "Address is required";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  // Handle form changes
  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors({ ...errors, [name]: "" });
    }
  };

  // Save profile
  const handleSave = async () => {
    if (!validateForm()) {
      return;
    }
    
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setIsEditing(false);
      setHasProfile(true);
      setLoading(false);
      setErrors({});
    }, 1000);
  };

  const handleCancel = () => {
    setIsEditing(false);
    // Reset form to original values if needed
  };

  const getGenderIcon = (gender) => {
    return <Users className="w-5 h-5" />;
  };

  const getInitials = (name) => {
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent mb-2">
            My Profile
          </h1>
          <p className="text-gray-600">Manage your personal information</p>
        </div>

        {/* Profile Card */}
        <div className="bg-white rounded-3xl shadow-xl overflow-hidden backdrop-blur-sm border border-white/20">
          {/* Profile Header */}
          <div className="bg-gradient-to-r from-blue-500 to-purple-600 px-8 py-12 text-white relative overflow-hidden">
            <div className="absolute inset-0 bg-black/10"></div>
            <div className="relative z-10">
              <div className="flex items-center space-x-6">
                <div className="w-20 h-20 bg-white/20 rounded-full flex items-center justify-center backdrop-blur-sm border border-white/30">
                  <span className="text-2xl font-bold text-white">
                    {getInitials(form.name)}
                  </span>
                </div>
                <div>
                  <h2 className="text-3xl font-bold mb-1">{form.name}</h2>
                  <p className="text-blue-100 flex items-center">
                    <Mail className="w-4 h-4 mr-2" />
                    {form.email}
                  </p>
                </div>
              </div>
            </div>
            {/* Decorative elements */}
            <div className="absolute top-4 right-4 w-32 h-32 bg-white/5 rounded-full"></div>
            <div className="absolute bottom-4 right-12 w-20 h-20 bg-white/5 rounded-full"></div>
          </div>

          {/* Profile Content */}
          <div className="p-8">
            {/* View Mode */}
            {hasProfile && !isEditing ? (
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-2xl border border-blue-200">
                    <div className="flex items-center mb-3">
                      <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center mr-4">
                        <User className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-blue-600 uppercase tracking-wide">Full Name</p>
                        <p className="text-xl font-semibold text-gray-800">{form.name}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-green-50 to-green-100 p-6 rounded-2xl border border-green-200">
                    <div className="flex items-center mb-3">
                      <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center mr-4">
                        <Phone className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-green-600 uppercase tracking-wide">Phone Number</p>
                        <p className="text-xl font-semibold text-gray-800">{form.phone}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-purple-50 to-purple-100 p-6 rounded-2xl border border-purple-200">
                    <div className="flex items-center mb-3">
                      <div className="w-10 h-10 bg-purple-500 rounded-full flex items-center justify-center mr-4">
                        <Calendar className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-purple-600 uppercase tracking-wide">Age</p>
                        <p className="text-xl font-semibold text-gray-800">{form.age} years</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-orange-50 to-orange-100 p-6 rounded-2xl border border-orange-200">
                    <div className="flex items-center mb-3">
                      <div className="w-10 h-10 bg-orange-500 rounded-full flex items-center justify-center mr-4">
                        {getGenderIcon(form.gender)}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-orange-600 uppercase tracking-wide">Gender</p>
                        <p className="text-xl font-semibold text-gray-800 capitalize">{form.gender}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-indigo-50 to-indigo-100 p-6 rounded-2xl border border-indigo-200">
                    <div className="flex items-center mb-3">
                      <div className="w-10 h-10 bg-indigo-500 rounded-full flex items-center justify-center mr-4">
                        <GraduationCap className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-indigo-600 uppercase tracking-wide">School/College</p>
                        <p className="text-xl font-semibold text-gray-800">{form.school}</p>
                      </div>
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-rose-50 to-rose-100 p-6 rounded-2xl border border-rose-200">
                    <div className="flex items-center mb-3">
                      <div className="w-10 h-10 bg-rose-500 rounded-full flex items-center justify-center mr-4">
                        <MapPin className="w-5 h-5 text-white" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-rose-600 uppercase tracking-wide">Address</p>
                        <p className="text-lg font-semibold text-gray-800 leading-relaxed">{form.address}</p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center space-x-2 px-8 py-3 bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-full hover:from-blue-600 hover:to-purple-700 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl"
                  >
                    <Edit3 className="w-5 h-5" />
                    <span className="font-semibold">Edit Profile</span>
                  </button>
                </div>
              </div>
            ) : (
              // Edit Mode
              <div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Full Name
                    </label>
                    <div className="relative">
                      <User className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        className={`w-full pl-12 pr-4 py-3 border rounded-xl focus:ring-2 transition-colors bg-gray-50 focus:bg-white ${
                          errors.name 
                            ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
                            : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                        }`}
                        placeholder="Enter your full name"
                      />
                    </div>
                    {errors.name && (
                      <div className="flex items-center mt-1 text-red-500 text-sm">
                        <AlertCircle className="w-4 h-4 mr-1" />
                        {errors.name}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Email Address
                    </label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <input
                        type="email"
                        name="email"
                        value={form.email}
                        onChange={handleChange}
                        disabled
                        className="w-full pl-12 pr-4 py-3 border border-gray-300 rounded-xl bg-gray-100 text-gray-500 cursor-not-allowed"
                        placeholder="Your email address"
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Phone Number
                    </label>
                    <div className="relative">
                      <Phone className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <input
                        type="tel"
                        name="phone"
                        value={form.phone}
                        onChange={handleChange}
                        className={`w-full pl-12 pr-4 py-3 border rounded-xl focus:ring-2 transition-colors bg-gray-50 focus:bg-white ${
                          errors.phone 
                            ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
                            : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                        }`}
                        placeholder="Enter your phone number"
                      />
                    </div>
                    {errors.phone && (
                      <div className="flex items-center mt-1 text-red-500 text-sm">
                        <AlertCircle className="w-4 h-4 mr-1" />
                        {errors.phone}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Age <span className="text-red-500">*</span>
                      <span className="text-xs text-gray-500 ml-1">(Must be 16 or older)</span>
                    </label>
                    <div className="relative">
                      <Calendar className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <input
                        type="number"
                        name="age"
                        value={form.age}
                        onChange={handleChange}
                        min="16"
                        max="120"
                        className={`w-full pl-12 pr-4 py-3 border rounded-xl focus:ring-2 transition-colors bg-gray-50 focus:bg-white ${
                          errors.age 
                            ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
                            : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                        }`}
                        placeholder="Enter your age (16+)"
                      />
                    </div>
                    {errors.age && (
                      <div className="flex items-center mt-1 text-red-500 text-sm">
                        <AlertCircle className="w-4 h-4 mr-1" />
                        {errors.age}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      School/College Name
                    </label>
                    <div className="relative">
                      <GraduationCap className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <input
                        type="text"
                        name="school"
                        value={form.school}
                        onChange={handleChange}
                        className={`w-full pl-12 pr-4 py-3 border rounded-xl focus:ring-2 transition-colors bg-gray-50 focus:bg-white ${
                          errors.school 
                            ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
                            : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                        }`}
                        placeholder="Enter your school or college name"
                      />
                    </div>
                    {errors.school && (
                      <div className="flex items-center mt-1 text-red-500 text-sm">
                        <AlertCircle className="w-4 h-4 mr-1" />
                        {errors.school}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Gender
                    </label>
                    <div className="relative">
                      <Users className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <select
                        name="gender"
                        value={form.gender}
                        onChange={handleChange}
                        className={`w-full pl-12 pr-4 py-3 border rounded-xl focus:ring-2 transition-colors bg-gray-50 focus:bg-white appearance-none ${
                          errors.gender 
                            ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
                            : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                        }`}
                      >
                        <option value="">Select Gender</option>
                        <option value="male">Male</option>
                        <option value="female">Female</option>
                        <option value="other">Other</option>
                      </select>
                    </div>
                    {errors.gender && (
                      <div className="flex items-center mt-1 text-red-500 text-sm">
                        <AlertCircle className="w-4 h-4 mr-1" />
                        {errors.gender}
                      </div>
                    )}
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <label className="block text-sm font-semibold text-gray-700 mb-2">
                      Address
                    </label>
                    <div className="relative">
                      <MapPin className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
                      <textarea
                        name="address"
                        value={form.address}
                        onChange={handleChange}
                        rows="3"
                        className={`w-full pl-12 pr-4 py-3 border rounded-xl focus:ring-2 transition-colors bg-gray-50 focus:bg-white resize-none ${
                          errors.address 
                            ? 'border-red-500 focus:ring-red-500 focus:border-red-500' 
                            : 'border-gray-300 focus:ring-blue-500 focus:border-blue-500'
                        }`}
                        placeholder="Enter your complete address"
                      />
                    </div>
                    {errors.address && (
                      <div className="flex items-center mt-1 text-red-500 text-sm">
                        <AlertCircle className="w-4 h-4 mr-1" />
                        {errors.address}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex justify-end space-x-4">
                  <button
                    onClick={handleCancel}
                    className="flex items-center space-x-2 px-6 py-3 border border-gray-300 text-gray-700 rounded-full hover:bg-gray-50 transition-colors"
                  >
                    <X className="w-5 h-5" />
                    <span className="font-medium">Cancel</span>
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={loading}
                    className="flex items-center space-x-2 px-8 py-3 bg-gradient-to-r from-green-500 to-green-600 text-white rounded-full hover:from-green-600 hover:to-green-700 transition-all duration-300 transform hover:scale-105 shadow-lg hover:shadow-xl disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none"
                  >
                    <Save className="w-5 h-5" />
                    <span className="font-semibold">
                      {loading ? "Saving..." : "Save Changes"}
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Additional Info Card */}
        <div className="mt-8 bg-white/70 backdrop-blur-sm rounded-2xl p-6 border border-white/20">
          <div className="text-center">
            <p className="text-gray-600">
              Keep your profile updated to ensure the best experience
            </p>
            <div className="flex justify-center space-x-4 mt-4">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}