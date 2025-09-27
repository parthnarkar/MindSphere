import React, { useState } from 'react';

const CounsellorProfileForm = ({ onSubmit, onCancel, isLoading = false }) => {
  const [form, setForm] = useState({
    name: '',
    number: '',
    email: '',
    specialization: '',
    experience: '',
    address: '',
    careerInformation: '',
    qualifications: '',
    languages: '',
    consultationFee: '',
    availability: '',
    bio: ''
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const submit = (e) => {
    e.preventDefault();
    // Basic required check: name and number
    if (!form.name || !form.number) {
      alert('Please provide name and phone number');
      return;
    }
    onSubmit && onSubmit(form);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
        <h3 className="text-xl font-bold mb-4">Complete your counsellor profile</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input name="name" value={form.name} onChange={handleChange} placeholder="Full name" className="border p-2 rounded" />
          <input name="number" value={form.number} onChange={handleChange} placeholder="Phone number" className="border p-2 rounded" />
          <input name="email" value={form.email} onChange={handleChange} placeholder="Email (optional)" className="border p-2 rounded" />
          <input name="specialization" value={form.specialization} onChange={handleChange} placeholder="Specialization" className="border p-2 rounded" />
          <input name="experience" value={form.experience} onChange={handleChange} placeholder="Experience (years)" className="border p-2 rounded" />
          <input name="consultationFee" value={form.consultationFee} onChange={handleChange} placeholder="Consultation Fee" className="border p-2 rounded" />
          <input name="languages" value={form.languages} onChange={handleChange} placeholder="Languages (comma separated)" className="border p-2 rounded md:col-span-2" />
          <input name="qualifications" value={form.qualifications} onChange={handleChange} placeholder="Qualifications" className="border p-2 rounded md:col-span-2" />
          <input name="availability" value={form.availability} onChange={handleChange} placeholder="Availability" className="border p-2 rounded md:col-span-2" />
          <input name="address" value={form.address} onChange={handleChange} placeholder="Address" className="border p-2 rounded md:col-span-2" />
          <textarea name="careerInformation" value={form.careerInformation} onChange={handleChange} placeholder="Career Information" className="border p-2 rounded md:col-span-2" />
          <textarea name="bio" value={form.bio} onChange={handleChange} placeholder="Short bio" className="border p-2 rounded md:col-span-2" />
        </div>

        <div className="mt-4 flex items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded bg-gray-100">Cancel</button>
          <button type="submit" disabled={isLoading} className="px-4 py-2 rounded bg-blue-600 text-white">{isLoading ? 'Saving...' : 'Save profile'}</button>
        </div>
      </form>
    </div>
  );
};

export default CounsellorProfileForm;
