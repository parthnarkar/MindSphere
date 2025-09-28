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
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [userResources, setUserResources] = useState([]);
  const [userChatHistory, setUserChatHistory] = useState([]);
  const [userPosts, setUserPosts] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMarkdown, setReportMarkdown] = useState('');
  const [showReportPreview, setShowReportPreview] = useState(false);
  const [MarkdownComponent, setMarkdownComponent] = useState(null);
  const [remarkGfmPlugin, setRemarkGfmPlugin] = useState(null);
  const [mdLoadError, setMdLoadError] = useState(false);
  const [sections, setSections] = useState({
    chatHistory: [],
    peerPosts: [],
    resources: [],
    phq9: []
  });

  // Form state
  // showProfileForm can be boolean or an object { open: true, allowEditIdentity: true }
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileLoadingState, setProfileLoadingState] = useState(true);

  const BACKEND = API;

  const [apptFilter, setApptFilter] = useState('New'); // New | Accepted | Rejected

  // Try to dynamically load react-markdown and remark-gfm so dev server won't fail
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const mod = await import(/* @vite-ignore */ 'react-markdown');
        const gfm = await import(/* @vite-ignore */ 'remark-gfm');
        if (!mounted) return;
        setMarkdownComponent(() => mod.default || mod);
        setRemarkGfmPlugin(() => gfm.default || gfm);
      } catch (e) {
        console.warn('react-markdown/remark-gfm not available:', e);
        if (mounted) setMdLoadError(true);
      }
    })();
    return () => { mounted = false; };
  }, []);

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
  // Listen for details loaded event dispatched by loadDetailsForUser
  useEffect(() => {
    const handler = (e) => {
      const d = e.detail || {};
      setUserResources(d.resourcesList || []);
      setUserChatHistory(d.chatMsgs || []);
      setUserPosts(d.posts || []);
      setDetailsLoading(false);
    };
    window.addEventListener('mindsphere:detailsLoaded', handler);
    return () => window.removeEventListener('mindsphere:detailsLoaded', handler);
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
      case "accepted": return "bg-green-100 text-green-700";
      case "completed": return "bg-green-100 text-green-700";
      case "rejected": return "bg-red-100 text-red-700";
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
        <div className="mb-4 flex items-center gap-2">
          <button className={`px-3 py-1 rounded ${apptFilter==='New' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`} onClick={() => setApptFilter('New')}>New</button>
          <button className={`px-3 py-1 rounded ${apptFilter==='Accepted' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`} onClick={() => setApptFilter('Accepted')}>Accepted</button>
          <button className={`px-3 py-1 rounded ${apptFilter==='Rejected' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700'}`} onClick={() => setApptFilter('Rejected')}>Rejected</button>
        </div>
        {appointments.length === 0 ? (
          <p className="text-gray-500 text-center py-10 text-base sm:text-lg">No booked appointments yet.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {appointments.filter(appt => {
              if (apptFilter === 'New') return !appt.status || appt.status === 'booked' || appt.status === 'pending' || appt.status === 'new';
              if (apptFilter === 'Accepted') return appt.status === 'accepted' || appt.status === 'completed';
              if (apptFilter === 'Rejected') return appt.status === 'rejected' || appt.status === 'cancelled';
              return true;
            }).map((appt) => (
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
                
                  
                  <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        // show details modal
                        const email = (appt.email || appt.user_email || appt.userEmail || '').toString().toLowerCase();
                        const entries = phqData.filter(p => (p.user_email || p.userEmail || '').toString().toLowerCase() === email);
                        setActivePhqEntries(entries);
                        setActiveAppointment(appt);
                                        setShowDetailsModal(true);
                                        // load extra details (resources, chat history, peer posts)
                                        loadDetailsForUser(email, appt);
                      }}
                      className="px-4 py-2 rounded bg-blue-50 text-blue-700 text-sm sm:text-base hover:bg-blue-100 w-full sm:w-auto text-center"
                    >
                      View Details
                    </button>
                    {/* Show accept/reject only when appointment is not already accepted/rejected */}
                    {!(appt.status === 'accepted' || appt.status === 'rejected' || appt.status === 'completed' || appt.status === 'cancelled') && (
                      <>
                        <button
                          type="button"
                          onClick={async () => {
                            // Accept appointment: update Firestore and notify server to persist in MongoDB
                            try {
                              const docRef = doc(db, 'appointments', appt.id);
                              await setDoc(docRef, { status: 'accepted' }, { merge: true });
                              // update local state
                              setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: 'accepted' } : a));
                              // notify backend
                              try {
                                await fetch(`${BACKEND}/api/appointments/${appt.id}/status`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: 'accepted', counsellorId: auth.currentUser.uid, email: appt.email })
                                });
                              } catch (e) {
                                console.warn('Backend status update failed', e);
                              }
                            } catch (e) {
                              console.error('Failed to accept appointment', e);
                              alert('Failed to accept appointment');
                            }
                          }}
                          className="px-4 py-2 rounded bg-green-50 text-green-700 text-sm sm:text-base hover:bg-green-100 w-full sm:w-auto text-center"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            // Reject appointment
                            try {
                              const docRef = doc(db, 'appointments', appt.id);
                              await setDoc(docRef, { status: 'rejected' }, { merge: true });
                              setAppointments(prev => prev.map(a => a.id === appt.id ? { ...a, status: 'rejected' } : a));
                              try {
                                await fetch(`${BACKEND}/api/appointments/${appt.id}/status`, {
                                  method: 'POST',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ status: 'rejected', counsellorId: auth.currentUser.uid, email: appt.email })
                                });
                              } catch (e) {
                                console.warn('Backend status update failed', e);
                              }
                            } catch (e) {
                              console.error('Failed to reject appointment', e);
                              alert('Failed to reject appointment');
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
      {/* Details modal (View Details) */}
      {showDetailsModal && activeAppointment && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowDetailsModal(false)}>
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full p-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold">Appointment Details: {activeAppointment.userName || activeAppointment.email}</h3>
                <p className="text-sm text-gray-500">Time: {activeAppointment.time ? new Date(activeAppointment.time).toLocaleString() : 'Unknown'}</p>
              </div>
              <div>
                <button onClick={() => setShowDetailsModal(false)} className="px-3 py-1 rounded bg-gray-100">Close</button>
              </div>
            </div>

            <div className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><div className="text-xs text-gray-500">Name</div><div className="font-medium">{activeAppointment.userName}</div></div>
                <div><div className="text-xs text-gray-500">Email</div><div className="font-medium">{activeAppointment.email}</div></div>
                <div><div className="text-xs text-gray-500">Contact</div><div className="font-medium">{activeAppointment.contact}</div></div>
                <div><div className="text-xs text-gray-500">Status</div><div className="font-medium">{activeAppointment.status}</div></div>
                <div className="sm:col-span-2"><div className="text-xs text-gray-500">Notes</div><div className="font-medium whitespace-pre-wrap">{activeAppointment.notes || '—'}</div></div>
              </div>

              <div>
                <h4 className="text-sm font-semibold">PHQ-9 Submissions</h4>
                {activePhqEntries.length === 0 ? (
                  <p className="text-sm text-gray-500">No submissions.</p>
                ) : (
                  <div className="space-y-2">
                    {activePhqEntries.map(p => (
                      <div key={p.id || p.user_email} className="border rounded p-2 bg-gray-50">
                        <div className="text-xs text-gray-500">Submitted: {p.timestamp ? new Date(p.timestamp).toLocaleString() : 'Unknown'}</div>
                        <div className="text-sm">Score: <strong>{p.totalScore ?? p.total_score}</strong> — {p.severity}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Additional client activity: resources accessed, chat history, peer posts */}
              <div className="mt-4">
                <h4 className="text-sm font-semibold">Resources accessed / suggested</h4>
                {detailsLoading ? (
                  <p className="text-sm text-gray-500">Loading...</p>
                ) : (userResources && userResources.length > 0) ? (
                  <ul className="space-y-2">
                    {userResources.map(r => (
                      <li key={r.id || r.title} className="text-sm text-gray-700">
                        <a className="text-indigo-600 underline" href={r.url || '#'} target="_blank" rel="noreferrer">{r.title || r.name}</a>
                        {r.type && <span className="ml-2 text-xs text-gray-500">{r.type}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-gray-500">No resource activity found. Showing suggested resources.</p>
                )}
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-semibold">Chatbot history (500‑word summary)</h4>
                {detailsLoading ? (
                  <p className="text-sm text-gray-500">Loading...</p>
                ) : (userChatHistory && userChatHistory.length > 0) ? (
                  <div className="space-y-2">
                    {/* Render a deterministic extractive 500-word summary of the chat history */}
                    <ChatSummaryBlock messages={userChatHistory} />
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No chat history found for this user.</p>
                )}
              </div>

              <div className="mt-4">
                <h4 className="text-sm font-semibold">Peer-to-peer posts</h4>
                {detailsLoading ? (
                  <p className="text-sm text-gray-500">Loading...</p>
                ) : (userPosts && userPosts.length > 0) ? (
                  <div className="space-y-2">
                    {userPosts.map(p => (
                      <div key={p.id} className="border rounded p-2 bg-gray-50">
                        <div className="text-sm font-medium">{p.title}</div>
                        <div className="text-xs text-gray-500">{p.createdAt}</div>
                        <div className="text-sm mt-1">{p.content || p.body || ''}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">No peer posts found for this user.</p>
                )}
              </div>
                  <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-gray-600">Actions</div>
                <div className="flex items-center gap-2">
                  <button onClick={async () => {
                    if (!activeAppointment) return;
                    setReportLoading(true);
                    try {
                      // Format data for API calls
                      const chatData = (userChatHistory || []).map(msg => ({
                        role: msg.from || msg.role || 'unknown',
                        content: msg.text || msg.message || msg.content || ''
                      }));

                      const peerData = (userPosts || []).map(post => ({
                        title: post.title || '(Untitled)',
                        content: post.content || post.body || ''
                      }));

                      const resourceData = (userResources || []).map(res => ({
                        title: res.title || res.name || '',
                        type: res.type || 'unknown',
                        language: res.language || 'English'
                      }));

                      const phqData = (activePhqEntries || []).map(entry => ({
                        timestamp: entry.timestamp || entry.submittedAt || '',
                        total_score: entry.total_score || entry.totalScore || 0,
                        answers: entry.answers || []
                      }));

                      // Helper: return default points or call backend when data exists
                      const defaultPoints = Array.from({ length: 5 }, () => 'No data available for analysis.');
                      const getSummaryForSection = async (data, sectionName) => {
                        // If there's no usable data, return default immediately
                        const isEmpty = data == null || (Array.isArray(data) && data.length === 0) || (typeof data === 'string' && data.trim() === '');
                        if (isEmpty) return { points: defaultPoints };
                        try {
                          const res = await fetch(`${BACKEND}/api/summarize`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ text: data, section: sectionName })
                          });
                          if (!res.ok) {
                            // don't throw; return defaults to keep UI stable
                            return { points: defaultPoints };
                          }
                          const body = await res.json();
                          return { points: (body && Array.isArray(body.points) && body.points.length > 0) ? body.points : defaultPoints };
                        } catch (e) {
                          console.warn(`Summary fetch failed for ${sectionName}`, e);
                          return { points: defaultPoints };
                        }
                      };

                      // Fetch summaries in parallel but skip empty sections automatically
                      const [chatSummary, peerSummary, resourceSummary, phqSummary] = await Promise.all([
                        getSummaryForSection(chatData, 'chat'),
                        getSummaryForSection(peerData, 'peer'),
                        getSummaryForSection(resourceData, 'resources'),
                        getSummaryForSection(phqData, 'phq9')
                      ]);

                      setSections({
                        chatHistory: chatSummary.points || [],
                        peerPosts: peerSummary.points || [],
                        resources: resourceSummary.points || [],
                        phq9: phqSummary.points || []
                      });

                      // Default messages if sections are empty
                      const defaultMessage = "No data available for analysis.";
                      const formatSection = (points) => (points && points.length > 0) ?
                        points.map(point => `- ${point}`).join('\n') :
                        `- ${defaultMessage}`;

                      // Generate markdown report with the new format
                      const report = `
# Client Report: ${activeAppointment.userName || 'Client'}

## Basic Information
- **Name:** ${activeAppointment.userName || 'Not provided'}
- **Email:** ${activeAppointment.email || 'Not provided'}
- **Contact:** ${activeAppointment.contact || 'Not provided'}
- **Appointment Date:** ${activeAppointment.time ? new Date(activeAppointment.time).toLocaleString() : 'Not scheduled'}
- **Status:** ${activeAppointment.status || 'Unknown'}

## Chat History Analysis
${formatSection(chatSummary.points)}

## Peer Forum Activity
${formatSection(peerSummary.points)}

## Resource Engagement
${formatSection(resourceSummary.points)}

## PHQ-9 Screening Summary
${formatSection(phqSummary.points)}
`;

                      setReportMarkdown(report);
                      setShowReportPreview(true);
                    } catch (e) {
                      console.error('Report generation failed', e);
                      // Show a more user-friendly error message
                      const errorMessage = e.message || 'An unexpected error occurred';
                      const friendlyMessage = errorMessage.startsWith('Failed to fetch') ?
                        'Unable to connect to the server. Please check your internet connection and try again.' :
                        `Report generation failed: ${errorMessage}`;
                      alert(friendlyMessage);
                    } finally {
                      setReportLoading(false);
                    }
                  }} 
                  className={`px-3 py-2 rounded ${reportLoading ? 'bg-indigo-300' : 'bg-indigo-600'} text-white flex items-center justify-center gap-2`} 
                  disabled={reportLoading}>
                    {reportLoading ? (
                      <span className="flex items-center gap-2"><svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8z"></path></svg> Generating...</span>
                    ) : 'Generate Report'}
                  </button>
                  {showReportPreview && (
                    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/40 p-4">
                      <div className="bg-white rounded-lg shadow-xl max-w-3xl w-full p-4 max-h-[90vh] overflow-y-auto" onClick={(e)=>e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                          <h3 className="text-lg font-semibold">Report Preview</h3>
                          <div className="flex items-center gap-2">
                            <button onClick={async () => {
                              // Download PDF using stored markdown
                              try {
                                const mdToRender = reportMarkdown || '';
                                const { jsPDF } = await import('jspdf');
                                const doc2 = new jsPDF({ unit: 'pt', format: 'a4' });
                                const margin = 40;
                                const pageWidth = (doc2.internal.pageSize && (doc2.internal.pageSize.width || (doc2.internal.pageSize.getWidth && doc2.internal.pageSize.getWidth()))) || 595.28; // fallback A4
                                const pageHeight = (doc2.internal.pageSize && (doc2.internal.pageSize.height || (doc2.internal.pageSize.getHeight && doc2.internal.pageSize.getHeight()))) || 841.89; // fallback A4
                                const usableWidth = pageWidth - margin * 2;
                                const usableHeight = pageHeight - margin * 2;

                                let y = margin;
                                const lines = (mdToRender || '').split('\n');
                                // Try to find a title (first H1 or fallback)
                                const titleLine = lines.find(l => l.trim().startsWith('#')) || `Client Report: ${(activeAppointment.userName||'Client')}`;

                                // Helper to add a new page and reset y
                                const addNewPage = () => {
                                  doc2.addPage();
                                  y = margin;
                                };

                                // Render title on first page
                                doc2.setFont('helvetica', 'bold');
                                doc2.setFontSize(18);
                                const title = titleLine.replace(/^#+\s*/, '');
                                const titleLines = doc2.splitTextToSize(title, usableWidth);
                                doc2.text(titleLines, margin, y);
                                y += (titleLines.length * 18) + 8;

                                doc2.setFontSize(11);
                                doc2.setFont('helvetica', 'normal');

                                // Generic line height settings
                                const lineHeight = 12; // for body text
                                const bulletLineHeight = 12;

                                for (let i = 0; i < lines.length; i++) {
                                  let rawLine = lines[i] || '';
                                  let line = rawLine.trim();
                                  if (!line) { y += 6; if (y > margin + usableHeight) addNewPage(); continue; }

                                  const headingMatch = line.match(/^(#{1,6})\s*(.*)$/);
                                  if (headingMatch) {
                                    const level = headingMatch[1].length;
                                    const content = headingMatch[2].replace(/\*\*(.*?)\*\*/g, '$1').replace(/#/g, '').trim();
                                    if (!content) { y += 6; if (y > margin + usableHeight) addNewPage(); continue; }
                                    doc2.setFont('helvetica', 'bold');
                                    let fontSize = 12;
                                    if (level === 1) fontSize = 16;
                                    else if (level === 2) fontSize = 13;
                                    else fontSize = 12;
                                    doc2.setFontSize(fontSize);
                                    const wrapped = doc2.splitTextToSize(content, usableWidth);
                                    // paginate if needed
                                    if (y + (wrapped.length * (fontSize + 2)) > margin + usableHeight) addNewPage();
                                    doc2.text(wrapped, margin, y);
                                    y += wrapped.length * (fontSize + 2) + 6;
                                    doc2.setFont('helvetica', 'normal');
                                    doc2.setFontSize(11);
                                    continue;
                                  }

                                  if (/^(-|\u2022)\s+/.test(line)) {
                                    const text = line.replace(/^(-|\u2022)\s+/, '• ');
                                    const cleaned = text.replace(/\*\*(.*?)\*\*/g, '$1');
                                    const splitted = doc2.splitTextToSize(cleaned, usableWidth - 12);
                                    // if not enough space, add page
                                    if (y + (splitted.length * bulletLineHeight) > margin + usableHeight) addNewPage();
                                    doc2.text(splitted, margin + 8, y);
                                    y += splitted.length * bulletLineHeight + 4;
                                    // continue to next line
                                    continue;
                                  }

                                  const sanitized = line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/#/g, '').trim();
                                  const para = doc2.splitTextToSize(sanitized, usableWidth);
                                  // paginate if para will overflow
                                  if (y + (para.length * lineHeight) > margin + usableHeight) {
                                    // If paragraph is longer than a page, write in chunks
                                    let idx = 0;
                                    while (idx < para.length) {
                                      const remainingLines = para.slice(idx);
                                      // estimate how many lines fit
                                      const fitLines = Math.floor((margin + usableHeight - y) / lineHeight) || 1;
                                      const chunk = remainingLines.slice(0, fitLines);
                                      doc2.text(chunk, margin, y);
                                      idx += chunk.length;
                                      y += chunk.length * lineHeight;
                                      if (idx < para.length) addNewPage();
                                    }
                                  } else {
                                    doc2.text(para, margin, y);
                                    y += para.length * lineHeight + 6;
                                  }

                                  if (y > margin + usableHeight) addNewPage();
                                }

                                const filename = `${(activeAppointment.userName||'report').replace(/\s+/g,'_')}_report.pdf`;
                                doc2.save(filename);
                              } catch (e) {
                                console.error('Download failed', e);
                                alert('Download failed: ' + (e.message || e));
                              }
                            }} className="px-3 py-1 rounded bg-green-600 text-white">Download PDF</button>
                            <button onClick={() => { setShowReportPreview(false); setReportMarkdown(''); }} className="px-3 py-1 rounded bg-gray-100">Close</button>
                          </div>
                        </div>
                        <div className="mt-3 border rounded p-3 bg-white max-h-[70vh] overflow-y-auto prose prose-sm">
                          {MarkdownComponent && remarkGfmPlugin ? (
                            <MarkdownComponent remarkPlugins={[remarkGfmPlugin]}>{reportMarkdown}</MarkdownComponent>
                          ) : mdLoadError ? (
                            <div className="text-sm text-gray-500 whitespace-pre-wrap font-mono">{reportMarkdown || 'No preview available.'}</div>
                          ) : (
                            <div className="text-sm text-gray-500">Loading preview renderer...</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
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

async function loadDetailsForUser(email, appt) {
  // This file-level helper will be imported by the component via closure. Use backend BASE from window if necessary.
  const base = typeof API !== 'undefined' ? API : '';
  // set loading
  try {
    // attempt to get suggested/local resources
    const resourcesRes = await fetchJsonSafe(`${base}/api/resources`);
    const resourcesList = (resourcesRes && resourcesRes.resources) || [];

    // chat sessions by email
    let chatMsgs = [];
    if (email) {
      const sessionsRes = await fetchJsonSafe(`${base}/api/chat/session?email=${encodeURIComponent(email)}`);
      const sessions = (sessionsRes && sessionsRes.sessions) || [];
      if (sessions.length > 0) {
        // pick the most recent session id
        const sid = sessions[0].id;
        const msgsRes = await fetchJsonSafe(`${base}/api/chat/session/${encodeURIComponent(sid)}/messages?email=${encodeURIComponent(email)}`);
        chatMsgs = (msgsRes && msgsRes.messages) || msgsRes || [];
      }
    }

    // peer posts
    let posts = [];
    if (email) {
      const postsRes = await fetchJsonSafe(`${base.replace(/\/$/, '')}/api/posts`);
      const allPosts = postsRes || [];
      // filter by author/email heuristics
      posts = Array.isArray(allPosts) ? allPosts.filter(p => {
        const a = (p.author || p.authorName || p.email || '').toString().toLowerCase();
        return a && email && a.includes(email.split('@')[0]);
      }) : [];
    }

    // Update state in the component via the global window - find React hook setters
    try {
      // we assume the component setUserResources etc are in scope; fall back to window update via event
      // Using a custom DOM event to deliver the loaded data to the component instance
      window.dispatchEvent(new CustomEvent('mindsphere:detailsLoaded', { detail: { resourcesList, chatMsgs, posts } }));
    } catch (e) {
      console.warn('Could not dispatch details event', e);
    }
  } catch (e) {
    console.warn('loadDetailsForUser failed', e);
  }
}


export default CounsellorDashboard;

// Small deterministic extractive summarizer component for chat history (client-side)
function ChatSummaryBlock({ messages }) {
  // messages: array of objects with text/message/content
  const [serverSummary, setServerSummary] = React.useState(null);
  const [loading, setLoading] = React.useState(false);
  const joined = (messages || []).map(m => (m.text || m.message || m.content || '')).join('\n');

  React.useEffect(() => {
    let mounted = true;
    (async () => {
      if (!joined || joined.trim().length === 0) return;
      setLoading(true);
      try {
        const res = await fetch(`${API}/api/chat/summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: messages })
        });
        if (!mounted) return;
        if (!res.ok) {
          // fallback to local summarizer
          setServerSummary(null);
        } else {
          const body = await res.json();
          setServerSummary(body.summary || null);
        }
      } catch (e) {
        setServerSummary(null);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [joined]);

  // Local fallback summarizer (deterministic extractive) — same logic as before but used only if server fails
  const localSummarize = (fullText) => {
    if (!fullText || typeof fullText !== 'string') return '';
    const sentences = fullText.trim().split(/(?<=[.!?])\s+/);
    if (!sentences || sentences.length === 0) return fullText.split(/\s+/).slice(0,500).join(' ');
    const stopwords = new Set(['the','and','is','in','it','of','to','a','i','that','you','for','on','with','this','was','are','be','have','not','as','but','or','they','we','he','she']);
    const freqs = {};
    for (const s of sentences) {
      for (const w of (s.match(/\w+/g) || []).map(x => x.toLowerCase())) {
        if (stopwords.has(w) || w.length <= 2) continue;
        freqs[w] = (freqs[w] || 0) + 1;
      }
    }
    const scored = sentences.map((s, idx) => {
      const words = (s.match(/\w+/g) || []).map(x => x.toLowerCase());
      const score = words.reduce((acc, w) => acc + (freqs[w] || 0), 0);
      return { idx, score, text: s };
    });
    const positive = scored.filter(x => x.score > 0);
    const selection = positive.length ? positive.sort((a,b) => b.score - a.score || a.idx - b.idx).map(x => x.idx) : scored.map(x => x.idx);
    const selected = [];
    let totalWords = 0;
    for (const i of selection) {
      const s = sentences[i];
      const wcount = (s.match(/\w+/g) || []).length;
      if (totalWords + wcount > 500 && totalWords > 0) break;
      selected.push(s.trim());
      totalWords += wcount;
      if (totalWords >= 500) break;
    }
    if (totalWords < 500) {
      for (let i = 0; i < sentences.length && totalWords < 500; i++) {
        if (!selection.includes(i)) {
          const s = sentences[i];
          const wcount = (s.match(/\w+/g) || []).length;
          if (totalWords + wcount > 500) {
            const rem = 500 - totalWords;
            const words = (s.match(/\w+/g) || []).slice(0, rem);
            if (words.length) {
              selected.push(words.join(' '));
              totalWords = 500;
            }
            break;
          }
          selected.push(s.trim());
          totalWords += wcount;
        }
      }
    }
    return selected.join(' ');
  };

  const rendered = loading ? 'Generating summary...' : (serverSummary || localSummarize(joined) || 'No chat content available.');

  return (
    <div className="text-sm text-gray-700 bg-gray-50 p-3 rounded whitespace-pre-wrap">
      {rendered}
    </div>
  );
}
