import React, { useEffect, useState } from "react";
import userIcon from '../assets/mindsphere-logo.png';
import { db, auth } from "../firebase";
import { collection, query, where, getDocs, doc, getDoc, setDoc } from "firebase/firestore";
import CounsellorProfileForm from "../components/CounsellorProfileForm";
import { API } from "../hooks/helper";

const CounsellorDashboard = () => {
  const [appointments, setAppointments] = useState([]);
  const [counsellor, setCounsellor] = useState(null);
  // PHQ-9 state
  const [phqData, setPhqData] = useState([]);
  const [phqLoading, setPhqLoading] = useState(true);
  const [phqError, setPhqError] = useState(null);
  // Modal state for showing PHQ entries per appointment
  const [showPhqModal, setShowPhqModal] = useState(false);
  const [activePhqEntries, setActivePhqEntries] = useState([]);
  const [activeAppointment, setActiveAppointment] = useState(null);

  // Form state
  // showProfileForm can be boolean or an object { open: true, allowEditIdentity: true }
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLoadingState, setProfileLoadingState] = useState(true);

  const BACKEND = API;

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
          const requiredFields = ['name', 'number', 'email', 'specialization', 'experience', 'address', 'careerInformation'];
          const isProfileComplete = requiredFields.every(field => data[field] && data[field].trim() !== '');
          
          if (!isProfileComplete) {
            setShowProfileForm(true);
          }
        } else {
          // No profile exists, show form
          setShowProfileForm(true);
        }
      } catch (error) {
        console.error("Error fetching counsellor info:", error);
        // On error, show form to allow user to create profile
        setShowProfileForm(true);
      } finally {
        setProfileLoadingState(false);
      }
    };
    fetchCounsellorInfo();
  }, []);

  // Fetch appointments
  useEffect(() => {
    const fetchAppointments = async () => {
      if (!auth.currentUser) return;
      try {
        const q = query(
          collection(db, "appointments"),
          where("counsellorId", "==", auth.currentUser.uid)
        );
        const snapshot = await getDocs(q);
        setAppointments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
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
          if (score >= 20) return 'Severe';
          if (score >= 15) return 'Moderately severe';
          if (score >= 10) return 'Moderate';
          if (score >= 5) return 'Mild';
          return 'Minimal';
        };
        const normalized = arr.map(r => ({
          ...r,
          user_email: (r.user_email || r.userEmail || '').toLowerCase(),
          totalScore: r.total_score ?? r.totalScore ?? (Array.isArray(r.answers) ? r.answers.reduce((s,a)=>s+(Number(a)||0),0) : undefined),
          severity: computeSeverity(r.total_score ?? r.totalScore ?? (Array.isArray(r.answers) ? r.answers.reduce((s,a)=>s+(Number(a)||0),0) : 0))
        }));
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
      if (e.key === 'Escape') setShowPhqModal(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showPhqModal]);

  const getStatusColor = (status) => {
    switch (status) {
      case "booked": return "bg-blue-100 text-blue-700";
      case "completed": return "bg-green-100 text-green-700";
      case "cancelled": return "bg-red-100 text-red-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  const handleProfileSubmit = async (formData) => {
    setProfileLoading(true);
    try {
      const profileData = {
        ...formData,
        email: auth.currentUser.email, // Use the authenticated user's email
        createdAt: new Date(),
        updatedAt: new Date()
      };

      // Save to Firestore
      const docRef = doc(db, "counsellors", auth.currentUser.uid);
      await setDoc(docRef, profileData, { merge: true });

      // Update local state
      setCounsellor({ id: auth.currentUser.uid, ...profileData });
      setShowProfileForm(false);
      alert('Profile saved successfully!');
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Error saving profile. Please try again.');
    } finally {
      setProfileLoading(false);
    }
  };

  const handleProfileCancel = () => {
    setShowProfileForm(false);
  };

  // Show loading state while fetching profile
  if (profileLoadingState) {
    return (
      <div className="min-h-screen bg-gray-50 p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your profile...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-blue-700 mb-6">Counsellor Dashboard</h1>

      {/* Profile Form Modal */}
      {showProfileForm && (
        <CounsellorProfileForm
          user={counsellor || {
            name: auth.currentUser?.displayName || '',
            email: auth.currentUser?.email || '',
            specialization: ''
          }}
          onSubmit={handleProfileSubmit}
          onCancel={handleProfileCancel}
          isLoading={profileLoading}
          allowEditIdentity={typeof showProfileForm === 'object' ? !!showProfileForm.allowEditIdentity : false}
        />
      )}

      {/* Counsellor Info */}
      {counsellor && (
  <div className="bg-white shadow-lg rounded-2xl p-4 sm:p-6 mb-8">
            <div className="flex flex-col md:flex-row items-start gap-6">
              <div className="w-20 h-20 sm:w-28 sm:h-28 md:w-32 md:h-32 rounded-full border-2 border-blue-100 overflow-hidden bg-blue-50 flex items-center justify-center mx-auto md:mx-0">
                <img
                  src={counsellor.image || userIcon}
                  alt={counsellor.name || 'Counsellor'}
                  className="w-full h-full object-cover"
                  onError={(e) => { /* fall back to bundled logo if provided image fails to load */
                    // avoid infinite loop if userIcon also errors
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = userIcon;
                  }}
                />
              </div>
            <div className="flex-1">
              <h2 className="text-lg sm:text-2xl md:text-3xl font-bold text-gray-800 mb-3 text-center md:text-left">{counsellor.name}</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 gap-4 text-sm sm:text-base">
                <div>
                  <p className="text-gray-600 mb-2"><span className="font-medium">Specialization:</span> {counsellor.specialization}</p>
                  <p className="text-gray-600 mb-2"><span className="font-medium">📧 Email:</span> {counsellor.email}</p>
                  <p className="text-gray-600 mb-2"><span className="font-medium">📞 Phone:</span> {counsellor.number}</p>
                  <p className="text-gray-600 mb-2"><span className="font-medium">Experience:</span> {counsellor.experience} years</p>
                  {counsellor.location && (
                    <p className="text-gray-600 mb-2"><span className="font-medium">Location:</span> {counsellor.location}</p>
                  )}
                </div>
                <div>
                  {counsellor.qualifications && (
                    <p className="text-gray-600 mb-2"><span className="font-medium">Qualifications:</span> {counsellor.qualifications}</p>
                  )}
                  {counsellor.languages && (
                    <p className="text-gray-600 mb-2"><span className="font-medium">Languages:</span> {counsellor.languages}</p>
                  )}
                  {counsellor.consultationFee && (
                    <p className="text-gray-600 mb-2"><span className="font-medium">Consultation Fee:</span> ₹{counsellor.consultationFee}</p>
                  )}
                  {counsellor.availability && (
                    <p className="text-gray-600 mb-2"><span className="font-medium">Availability:</span> {counsellor.availability}</p>
                  )}
                </div>
              </div>

              {counsellor.address && (
                <div className="mt-4">
                  <p className="text-gray-600 text-sm sm:text-base"><span className="font-medium">Address:</span> {counsellor.address}</p>
                </div>
              )}

              {counsellor.careerInformation && (
                <div className="mt-4">
                  <p className="text-gray-600 text-sm sm:text-base"><span className="font-medium">Career Information:</span></p>
                  <p className="text-gray-600 text-sm sm:text-base mt-1">{counsellor.careerInformation}</p>
                </div>
              )}

              {counsellor.bio && (
                <div className="mt-4">
                  <p className="text-gray-600 text-sm sm:text-base"><span className="font-medium">Bio:</span></p>
                  <p className="text-gray-600 text-sm sm:text-base mt-1">{counsellor.bio}</p>
                </div>
              )}
              <div className="mt-4 flex flex-col sm:flex-row sm:items-center gap-3">
                {/* Open profile form for editing profile details, but identity fields remain read-only */}
                <button onClick={() => setShowProfileForm(true)} className="px-4 py-2 rounded bg-blue-50 text-blue-700 w-full sm:w-auto text-center text-sm sm:text-base">Edit profile</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Booking Appointments Section */}
      <div className="mb-8">
  <h2 className="text-xl sm:text-2xl font-bold text-blue-700 mb-4">Booking Appointments</h2>
        {appointments.length === 0 ? (
          <p className="text-gray-500 text-center py-10 text-base sm:text-lg">No booked appointments yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {appointments.map((appt) => (
              <div key={appt.id} className="bg-white shadow-lg rounded-2xl p-4 sm:p-5 lg:p-6 hover:shadow-2xl transition duration-300 w-full">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-3 gap-2">
                  <h3 className="text-lg sm:text-xl font-semibold text-gray-800">{appt.userName}</h3>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(appt.status)}`}>
                    {appt.status}
                  </span>
                </div>
                <div className="text-gray-600 text-sm sm:text-base space-y-1 break-words">
                  {appt.email && <p className="truncate">📧 {appt.email}</p>}
                  {appt.contact && <p>📞 {appt.contact}</p>}
                  <p>⏰ {new Date(appt.time).toLocaleString()}</p>
                  {appt.createdAt && (
                    <p className="text-gray-400 text-xs">
                      Booked on: {appt.createdAt.toDate().toLocaleString()}
                    </p>
                  )}
                  
                  <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        // find PHQ entries for this appointment's email
                        const email = (appt.email || appt.user_email || appt.userEmail || '').toString().toLowerCase();
                        const entries = phqData.filter(p => (p.user_email || p.userEmail || '').toString().toLowerCase() === email);
                        setActivePhqEntries(entries);
                        setActiveAppointment(appt);
                        setShowPhqModal(true);
                      }}
                      className="px-4 py-2 rounded bg-blue-50 text-blue-700 text-sm sm:text-base hover:bg-blue-100 w-full sm:w-auto text-center"
                    >
                      View PHQ
                    </button>
                    <button
                      type="button"
                      onClick={() => { /* future: navigate to appointment details */ }}
                      className="px-4 py-2 rounded bg-gray-50 text-gray-700 text-sm sm:text-base hover:bg-gray-100 w-full sm:w-auto text-center"
                    >
                      Details
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      {/* PHQ modal (per-appointment) */}
      {showPhqModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowPhqModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">PHQ-9 Submissions for {activeAppointment?.userName || activeAppointment?.email || 'Client'}</h3>
                <p className="text-sm text-gray-500">Appointment: {activeAppointment?.time ? new Date(activeAppointment.time).toLocaleString() : 'Unknown'}</p>
              </div>
              <div>
                <button onClick={() => setShowPhqModal(false)} className="px-3 py-1 rounded bg-gray-100">Close</button>
              </div>
            </div>

            <div className="mt-4">
              {phqLoading ? (
                <p className="text-gray-600">Loading PHQ-9 submissions...</p>
              ) : activePhqEntries.length === 0 ? (
                <p className="text-gray-500">No PHQ-9 submissions from this client.</p>
              ) : (
                <div className="space-y-4">
                  {activePhqEntries.map((p) => {
                    const time = p.timestamp ? new Date(p.timestamp).toLocaleString() : 'Unknown';
                    const answers = Array.isArray(p.answers) ? p.answers.join(', ') : '';
                    return (
                      <div key={p.id || p.user_email + '-' + time} className="bg-gray-50 border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-sm font-medium">{p.user_email || 'Unknown'}</div>
                          <div className="text-xs text-gray-500">{time}</div>
                        </div>
                        <div className="text-sm text-gray-700">Score: <strong>{p.totalScore ?? p.total_score ?? '—'}</strong></div>
                        <div className="text-sm text-gray-700">Severity: <strong>{p.severity || 'Unknown'}</strong></div>
                        {answers && (
                          <div className="mt-2 text-sm text-gray-600">
                            <div className="font-medium text-gray-700 mb-1">Answers</div>
                            <div className="text-xs bg-white p-3 rounded-md border">{answers}</div>
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
      </div>
    </div>
  );
};

export default CounsellorDashboard;
