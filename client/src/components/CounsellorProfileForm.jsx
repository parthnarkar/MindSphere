import React, { useState } from 'react';

const CounsellorProfileForm = ({ user = {}, onSubmit, onCancel, isLoading = false, allowEditIdentity = false }) => {
  const [form, setForm] = useState(() => ({
    name: user.name || '',
    number: user.number || user.phone || user.contact || '',
    email: user.email || '',
    specialization: user.specialization || '',
    experience: user.experience || '',
    address: user.address || '',
    careerInformation: user.careerInformation || user.careerInformation || '',
    qualifications: user.qualifications || '',
    languages: user.languages || '',
    consultationFee: user.consultationFee || user.consultationFee || '',
    availability: user.availability || '',
    bio: user.bio || '',
    image: user.image || user.photo || ''
  }));

  // Keep form in sync if parent provides user after initial render
  React.useEffect(() => {
    if (user) {
      setForm(prev => ({
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

  // Close on Escape key and allow backdrop click to cancel
  React.useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCancel && onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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
        className="bg-white rounded-xl shadow-xl w-full max-w-3xl p-4 sm:p-6 mx-2 sm:mx-4 box-border max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-lg sm:text-xl font-bold mb-2">Complete your counsellor profile</h3>
          <button type="button" aria-label="Close profile form" onClick={onCancel} className="ml-auto text-gray-500 hover:text-gray-700 p-1 rounded focus:outline-none">
            ×
          </button>
        </div>

        {/* Identity block - read-only or editable depending on allowEditIdentity */}
  <div className="mb-4 grid grid-cols-1 sm:grid-cols-3 gap-3 items-center">
          {allowEditIdentity ? (
            <>
              <div>
                <label className="text-xs text-gray-500">Name</label>
                <input name="name" value={form.name} onChange={handleChange} className="border p-2 rounded w-full block mt-1 text-sm sm:text-base" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Email</label>
                <input name="email" value={form.email} onChange={handleChange} className="border p-2 rounded w-full block mt-1 text-sm sm:text-base" />
              </div>
              <div>
                <label className="text-xs text-gray-500">Specialization</label>
                <input name="specialization" value={form.specialization} onChange={handleChange} className="border p-2 rounded w-full block mt-1 text-sm sm:text-base" />
              </div>
            </>
          ) : (
            <>
              <div className="col-span-1 sm:col-span-1">
                <label className="text-xs text-gray-500">Name</label>
                <div className="font-medium text-gray-800 truncate">{form.name || '—'}</div>
              </div>
              <div className="col-span-1 sm:col-span-1">
                <label className="text-xs text-gray-500">Email</label>
                <div className="font-medium text-gray-800 truncate">{form.email || '—'}</div>
              </div>
              <div className="col-span-1 sm:col-span-1">
                <label className="text-xs text-gray-500">Specialization</label>
                <div className="font-medium text-gray-800 truncate">{form.specialization || '—'}</div>
              </div>
            </>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500">Phone number</label>
            <input name="number" value={form.number} onChange={handleChange} placeholder="Phone number" className="border p-2 rounded w-full block mt-1 text-sm sm:text-base" autoFocus />
          </div>

          <div>
            <label className="text-xs text-gray-500">Experience (years)</label>
            <input name="experience" value={form.experience} onChange={handleChange} placeholder="Experience (years)" className="border p-2 rounded w-full block mt-1" />
          </div>

          <div>
            <label className="text-xs text-gray-500">Consultation Fee</label>
            <input name="consultationFee" value={form.consultationFee} onChange={handleChange} placeholder="Consultation Fee" className="border p-2 rounded w-full block mt-1" />
          </div>

          <div>
            <label className="text-xs text-gray-500">Languages</label>
            <input name="languages" value={form.languages} onChange={handleChange} placeholder="Languages (comma separated)" className="border p-2 rounded w-full block mt-1" />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Qualifications</label>
            <input name="qualifications" value={form.qualifications} onChange={handleChange} placeholder="Qualifications" className="border p-2 rounded w-full block mt-1" />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Availability</label>
            <input name="availability" value={form.availability} onChange={handleChange} placeholder="Availability" className="border p-2 rounded w-full block mt-1" />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Address</label>
            <input name="address" value={form.address} onChange={handleChange} placeholder="Address" className="border p-2 rounded w-full block mt-1" />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Career Information</label>
            <textarea name="careerInformation" value={form.careerInformation} onChange={handleChange} placeholder="Career Information" className="border p-2 rounded w-full block mt-1 min-h-[80px] sm:min-h-[120px] resize-vertical text-sm sm:text-base" />
          </div>

          <div className="sm:col-span-2">
            <label className="text-xs text-gray-500">Short bio</label>
            <textarea name="bio" value={form.bio} onChange={handleChange} placeholder="Short bio" className="border p-2 rounded w-full block mt-1 min-h-[70px] sm:min-h-[100px] resize-vertical text-sm sm:text-base" />
          </div>
        </div>

        <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3">
          <button type="button" onClick={onCancel} className="px-4 py-2 rounded bg-gray-100 w-full sm:w-auto">Cancel</button>
          <button type="submit" disabled={isLoading} className="px-4 py-2 rounded bg-blue-600 text-white w-full sm:w-auto">{isLoading ? 'Saving...' : 'Save profile'}</button>
        </div>
      </form>
    </div>
  );
};

export default CounsellorProfileForm;
