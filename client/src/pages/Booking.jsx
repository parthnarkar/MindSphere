import React, { useEffect, useState, useCallback } from "react";
import { db, auth } from "../firebase";
import logo from "../assets/mindsphere-logo.png";
import { collection, getDocs, addDoc, serverTimestamp, query, where } from "firebase/firestore";
import { toast } from "react-toastify";
import { getDoc, doc } from "firebase/firestore";

export default function Booking() {
  const [counsellors, setCounsellors] = useState([]);
  const [showPopup, setShowPopup] = useState(false);
  const [selectedCounsellor, setSelectedCounsellor] = useState(null);
  const [name, setName] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [time, setTime] = useState("");
  const [contact, setContact] = useState(""); 
  const [email, setEmail] = useState("");     
  const [bookingStatus, setBookingStatus] = useState(null);
  const [myBookings, setMyBookings] = useState([]);
  const [counsellorDetails, setCounsellorDetails] = useState(null);
  const [showDetailsPopup, setShowDetailsPopup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [problemDescription, setProblemDescription] = useState("");
  // Validation functions
  const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  };

  const validatePhone = (phone) => {
    const phoneRegex = /^[\+]?[1-9][\d]{0,15}$/;
    return phoneRegex.test(phone.replace(/\s/g, ''));
  };

  // Fetch counsellors from Firestore
  useEffect(() => {
    const fetchCounsellors = async () => {
      try {
        setLoading(true);
        const querySnapshot = await getDocs(collection(db, "counsellors"));
        setCounsellors(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error fetching counsellors:", error);
        toast.error("Failed to load counsellors. Please refresh the page.", {
          position: "top-right",
          autoClose: 5000,
        });
      } finally {
        setLoading(false);
      }
    };
    fetchCounsellors();
  }, []);

  // Fetch current user's bookings
  useEffect(() => {
    const fetchMyBookings = async () => {
      if (!auth.currentUser) return;
      try {
        const q = query(
          collection(db, "appointments"),
          where("userId", "==", auth.currentUser.uid)
        );
        const snapshot = await getDocs(q);
        setMyBookings(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error fetching user bookings:", error);
        toast.error("Failed to load your bookings.", {
          position: "top-right",
          autoClose: 3000,
        });
      }
    };
    fetchMyBookings();
  }, [bookingStatus]); // refresh when new booking is confirmed

  // Fetch counsellor details with error handling
  useEffect(() => {
    const fetchCounsellorDetails = async () => {
      if (!selectedCounsellor) {
        setCounsellorDetails(null);
        return;
      }
      
      try {
        const docRef = doc(db, "counsellors", selectedCounsellor.id);
        const docSnap = await getDoc(docRef);
        setCounsellorDetails(docSnap.exists() ? docSnap.data() : null);
      } catch (error) {
        console.error("Error fetching counsellor details:", error);
        // toast.error("Failed to load counsellor details.", {
        //   position: "top-right",
        //   autoClose: 3000,
        // });
        setCounsellorDetails(null);
      }
    };
    fetchCounsellorDetails();
  }, [selectedCounsellor]);

  // Reset form function
  const resetForm = useCallback(() => {
    setName("");
    setAnonymous(false);
    setTime("");
    setContact("");
    setEmail("");
    setBookingStatus(null);
  }, []);

  // Open popup
  const handleBookClick = (counsellor) => {
    setSelectedCounsellor(counsellor);
    setShowPopup(true);
    resetForm();
  };

  // Close popup with cleanup
  const handleClosePopup = () => {
    setShowPopup(false);
    setSelectedCounsellor(null);
    resetForm();
  };

  // Form validation
  const validateForm = () => {
    if (!time) {
      toast.error("Please select a preferred time.", {
        position: "top-right",
        autoClose: 3000,
      });
      return false;
    }

    if (!anonymous && !name.trim()) {
      toast.error("Please enter your name or book anonymously.", {
        position: "top-right",
        autoClose: 3000,
      });
      return false;
    }

    if (!contact.trim()) {
      toast.error("Please enter your contact number.", {
        position: "top-right",
        autoClose: 3000,
      });
      return false;
    }

    if (!validatePhone(contact)) {
      toast.error("Please enter a valid contact number.", {
        position: "top-right",
        autoClose: 3000,
      });
      return false;
    }

    if (!email.trim()) {
      toast.error("Please enter your email address.", {
        position: "top-right",
        autoClose: 3000,
      });
      return false;
    }

    if (!validateEmail(email)) {
      toast.error("Please enter a valid email address.", {
        position: "top-right",
        autoClose: 3000,
      });
      return false;
    }

    // Check if selected time is in the future
    const selectedTime = new Date(time);
    const now = new Date();
    if (selectedTime <= now) {
      toast.error("Please select a future date and time.", {
        position: "top-right",
        autoClose: 3000,
      });
      return false;
    }

    return true;
  };

  // Confirm booking with improved error handling
  const confirmBooking = async () => {
    if (!validateForm()) return;

    try {
      setLoading(true);
      await addDoc(collection(db, "appointments"), {
        userId: auth.currentUser.uid,
        userName: anonymous ? "Anonymous" : name.trim(),
        counsellorId: selectedCounsellor.id,
        counsellorName: selectedCounsellor.name,
        time,
        contact: contact.trim(),
        email: email.trim(),
        status: "booked",
        createdAt: serverTimestamp(),
        problemDescription: problemDescription.trim(),
      });
      
      // Show success toast
      toast.success(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">🎉 Booking Confirmed!</div>
          <div className="text-sm mt-1">
            Your appointment with <span className="font-medium">{selectedCounsellor.name}</span> has been booked successfully.
          </div>
          <div className="text-xs mt-2 text-gray-600">
            📅 {new Date(time).toLocaleDateString()} at {new Date(time).toLocaleTimeString()}
          </div>
        </div>,
        {
          position: "top-right",
          autoClose: 6000,
          hideProgressBar: false,
          closeOnClick: true,
          pauseOnHover: true,
          draggable: true,
          className: "custom-success-toast",
        }
      );
      
      setBookingStatus("success");
      
      // Auto-close popup after success
      setTimeout(() => {
        handleClosePopup();
      }, 2000);
      
    } catch (error) {
      console.error("Booking failed:", error);
      
      // Show error toast
      toast.error(
        <div className="flex flex-col">
          <div className="font-semibold text-lg">❌ Booking Failed</div>
          <div className="text-sm mt-1">
            Something went wrong while booking your appointment. Please try again.
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
      
      setBookingStatus("error");
    } finally {
      setLoading(false);
    }
  };

  // Handle view details
  const handleViewDetails = (counsellorId) => {
    const counsellor = counsellors.find(c => c.id === counsellorId);
    setSelectedCounsellor(counsellor);
    setShowDetailsPopup(true);
  };

  // Close details popup
  const handleCloseDetailsPopup = () => {
    setShowDetailsPopup(false);
    setSelectedCounsellor(null);
    setCounsellorDetails(null);
  };

  if (loading && counsellors.length === 0) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading counsellors...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-20 booking-root" style={{ backgroundColor: '#ffffffff', color: '#263238' }}>
      <style jsx global>{`
        html {
          scroll-behavior: smooth;
        }

        * {
          scroll-behavior: smooth;
        }

        .smooth-scroll {
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
        }

        .scrollbar-hide {
          scrollbar-width: none;
          -ms-overflow-style: none;
          -webkit-overflow-scrolling: touch;
        }

        .scrollbar-hide::-webkit-scrollbar {
          display: none;
        }

        /* Enhanced smooth scrolling for all scrollable elements */
        .smooth-scroll-enhanced {
          scroll-behavior: smooth;
          -webkit-overflow-scrolling: touch;
          scroll-padding-top: 2rem;
          scroll-snap-type: y proximity;
        }

        /* Momentum scrolling for iOS */
        .momentum-scroll {
          -webkit-overflow-scrolling: touch;
          overscroll-behavior: contain;
        }

        /* Booking page theme overrides (scoped by .booking-root) */
        .booking-root { color: #263238; background-color: #faf3efff; }

        /* Force commonly used background utility classes to the requested light shade */
        .booking-root .bg-white,
        .booking-root .bg-gray-50,
        .booking-root .bg-blue-50,
        .booking-root .bg-blue-100,
        .booking-root .bg-green-50,
        .booking-root .bg-green-100,
        .booking-root .bg-yellow-50,
        .booking-root .bg-gray-100,
        .booking-root .bg-gray-200 {
          background-color: #faf3efff !important;
        }

        /* Force text color to the requested shade for known utility text classes */
        .booking-root .text-blue-700,
        .booking-root .text-blue-600,
        .booking-root .text-blue-800,
        .booking-root .text-gray-600,
        .booking-root .text-gray-500,
        .booking-root .text-gray-700,
        .booking-root .text-gray-800,
        .booking-root .text-indigo-600,
        .booking-root .text-green-700,
        .booking-root .text-yellow-600,
        .booking-root .text-indigo-600 {
          color: #263238 !important;
        }

        /* Ensure buttons that used strong colors are readable but follow the page palette */
        .booking-root .bg-blue-600,
        .booking-root .bg-indigo-600,
        .booking-root .bg-green-600 {
          background-color: #faf3efff !important;
          color: #263238 !important;
          border: 1px solid rgba(38,50,56,0.08) !important;
        }

        /* Links and emphasized text should use the main text color */
        .booking-root a { color: #263238 !important; }
        .booking-root .font-medium { color: #263238 !important; }
      `}</style>
      <h2 className="text-3xl font-extrabold text-center text-blue-700 mb-6">
        Book a Counsellor
      </h2>

      <p className="text-center text-gray-600 mb-8 max-w-2xl mx-auto">
        Choose from available counsellors below and pick a time that works for you. You can book anonymously if preferred.
      </p>

      {/* Counsellor Placards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-12">
        {counsellors.map(c => (
          <div key={c.id} className="p-5 border rounded-2xl shadow hover:shadow-xl transition flex flex-col items-center bg-white">
            <img
              src={c.image || logo}
              alt={`${c.name} - Counsellor`}
              onError={(e) => { e.target.src = logo; }}
              className="w-24 h-24 rounded-full mb-3 border-2 border-blue-50 object-cover"
            />
            <h3 className="text-lg sm:text-xl font-semibold text-gray-800 text-center">{c.name}</h3>
            <p className="text-sm text-gray-600 mt-1 text-center">{c.specialization || 'Counselling'}</p>
            <div className="mt-3 text-center text-xs text-gray-500">
              <div>{c.email}</div>
              <div>{c.phone}</div>
            </div>
            <button
              className="mt-4 px-4 py-2 font-medium rounded-full transition disabled:opacity-50 hover:opacity-75 cursor-pointer shadow-sm hover:shadow-md"
              onClick={() => handleBookClick(c)}
              disabled={loading}
              aria-label={`Book appointment with ${c.name}`}
              style={{ backgroundColor: '#FF8C42', color: '#faf3efff', border: '1px solid rgba(38,50,56,0.12)' }}
            >
              Book
            </button>
            <button
              className="mt-3 px-4 py-2 rounded-lg transition cursor-pointer hover:opacity-75 font-medium shadow-sm hover:shadow-md"
              onClick={() => handleViewDetails(c.id)}
              aria-label={`View details for ${c.name}`}
              style={{ backgroundColor: '#faf3efff', color: '#263238', border: '1px solid #263238' }}
            >
              View Details
            </button>
          </div>
        ))}
      </div>

      {/* Details Popup */}
      {showDetailsPopup && counsellorDetails && (
        <div className="fixed inset-0 bg-opacity-70 backdrop-blur-sm flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full p-6 sm:p-8 animate-fadeIn overflow-y-auto max-h-[100vh] border-t-8 border-blue-600 relative scrollbar-hide smooth-scroll-enhanced momentum-scroll">
            <style jsx>{`
              .scrollbar-hide::-webkit-scrollbar {
                display: none;
              }
            `}</style>
            
            {/* Header with Image and Name */}
            <div className="flex items-center gap-4 mb-6">
              <div className="relative">
                <img 
                  src={counsellorDetails.image || logo} 
                  alt={`${counsellorDetails.name} - Counsellor`} 
                  onError={(e) => e.target.src = logo}
                  className="w-20 h-20 rounded-full object-cover border-4 border-blue-100 shadow-lg"
                />
                <div className="absolute -bottom-2 -right-2 bg-green-500 w-6 h-6 rounded-full border-3 border-white flex items-center justify-center">
                  <div className="w-2 h-2 bg-white rounded-full"></div>
                </div>
              </div>
              <div>
                <h3 className="text-2xl font-bold text-blue-800 mb-1">{counsellorDetails.name}</h3>
                <p className="text-blue-600 font-medium bg-blue-50 px-3 py-1 rounded-full text-sm">
                  {counsellorDetails.specialization || 'Counselling'}
                </p>
              </div>
            </div>

            {/* Details Grid */}
            <div className="space-y-4">
              {counsellorDetails.experience && (
                <div className="flex items-center gap-3 p-3 bg-blue-50 rounded-xl">
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                    <span className="text-blue-600 font-bold text-sm">📊</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Experience</p>
                    <p className="font-semibold text-gray-800">{counsellorDetails.experience} years</p>
                  </div>
                </div>
              )}

              {counsellorDetails.email && (
                <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl">
                  <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                    <span className="text-gray-600 font-bold text-sm">📧</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Email</p>
                    <p className="font-medium text-gray-800 break-all">{counsellorDetails.email}</p>
                  </div>
                </div>
              )}

              {counsellorDetails.phone && (
                <div className="flex items-center gap-3 p-3 bg-green-50 rounded-xl">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                    <span className="text-green-600 font-bold text-sm">📞</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Phone</p>
                    <p className="font-medium text-gray-800">{counsellorDetails.phone}</p>
                  </div>
                </div>
              )}

              {/* {counsellorDetails.location && (
                <div className="flex items-center gap-3 p-3 bg-purple-50 rounded-xl">
                  <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                    <span className="text-purple-600 font-bold text-sm">📍</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Location</p>
                    <p className="font-medium text-gray-800">{counsellorDetails.location}</p>
                  </div>
                </div>
              )} */}

              {counsellorDetails.qualifications && (
                <div className="flex items-start gap-3 p-3 bg-orange-50 rounded-xl">
                  <div className="w-8 h-8 bg-orange-100 rounded-full flex items-center justify-center mt-1">
                    <span className="text-orange-600 font-bold text-sm">🎓</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Qualifications</p>
                    <p className="font-medium text-gray-800">{counsellorDetails.qualifications}</p>
                  </div>
                </div>
              )}

              {counsellorDetails.consultationFee && (
                <div className="flex items-center gap-3 p-3 bg-yellow-50 rounded-xl">
                  <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                    <span className="text-yellow-600 font-bold text-sm">💰</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Consultation Fee</p>
                    <p className="font-medium text-gray-800">₹{counsellorDetails.consultationFee}</p>
                  </div>
                </div>
              )}

              {counsellorDetails.availability && (
                <div className="flex items-center gap-3 p-3 bg-teal-50 rounded-xl">
                  <div className="w-8 h-8 bg-teal-100 rounded-full flex items-center justify-center">
                    <span className="text-teal-600 font-bold text-sm">⏰</span>
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">Availability</p>
                    <p className="font-medium text-gray-800">{counsellorDetails.availability}</p>
                  </div>
                </div>
              )}

              {counsellorDetails.bio && (
                <div className="p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl border border-blue-100">
                  <p className="text-sm text-gray-600 mb-2">About</p>
                  <p className="text-gray-700 leading-relaxed">{counsellorDetails.bio}</p>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 mt-8">
              <button 
                className="flex-1 px-4 py-3 rounded-xl hover:transition font-medium shadow-lg hover:shadow-xl transform hover:scale-[1.02] cursor-pointer"
                onClick={() => {
                  handleCloseDetailsPopup();
                  handleBookClick(counsellorDetails);
                }}
                style={{ backgroundColor: '#faf3efff', color: '#263238', border: '1px solid rgba(38,50,56,0.12)' }}
              >
                Book Now
              </button>
              <button 
                className="px-4 py-3 bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition font-medium hover:transition font-medium shadow-sm hover:shadow-lg cursor-pointer"
                onClick={handleCloseDetailsPopup}
              >
                Close
              </button>
            </div>

            {/* Close button in top-right corner */}
            <button
              className="absolute top-4 right-4 w-8 h-8 bg-gray-100 hover:bg-gray-200 rounded-full flex items-center justify-center transition"
              onClick={handleCloseDetailsPopup}
              aria-label="Close popup"
            >
              <span className="text-gray-600 font-bold">×</span>
            </button>
          </div>
        </div>
      )}

      {/* Booking Popup */}
      {showPopup && selectedCounsellor && (
        <div className="fixed inset-0 bg-opacity-70 backdrop-blur-sm flex items-start sm:items-center justify-center z-50 px-4 py-6 sm:py-0">
          <div role="dialog" aria-modal="true" aria-labelledby="book-dialog-title" className="bg-white p-6 rounded-2xl shadow-2xl max-w-xl sm:w-full relative w-full animate-fadeIn smooth-scroll-enhanced momentum-scroll">
            <div className="flex items-center gap-3 mb-4">
              <img 
                src={selectedCounsellor.image || logo} 
                onError={(e) => {e.target.src = logo}} 
                alt={`${selectedCounsellor.name} - Counsellor`} 
                className="w-12 h-12 rounded-full object-cover" 
              />
              <div>
                <h3 id="book-dialog-title" className="text-xl font-bold text-blue-700">
                  Book with {selectedCounsellor.name}
                </h3>
                <div className="text-sm text-gray-600">{selectedCounsellor.specialization}</div>
              </div>
            </div>

            <form className="grid grid-cols-1 sm:grid-cols-2 gap-4" onSubmit={(e) => e.preventDefault()}> 
              <div className="sm:col-span-2 flex items-center gap-3">
                <input
                  id="anonymous"
                  type="checkbox"
                  className="w-5 h-5 accent-blue-600"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                  aria-describedby="anonymous-help"
                />
                <label htmlFor="anonymous" className="text-gray-700 font-medium">Book anonymously</label>
                <span id="anonymous-help" className="sr-only">Check this to book without providing your name</span>
              </div>

              <label className="block sm:col-span-2">
                <span className="text-gray-700 font-medium">
                  Your Name {!anonymous && <span className="text-red-500">*</span>}
                </span>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent disabled:bg-gray-100 w-full"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={anonymous}
                  placeholder={anonymous ? "Booking anonymously" : "Enter your name"}
                  aria-required={!anonymous}
                />
              </label>

              <label className="block">
                <span className="text-gray-700 font-medium">
                  Contact Number <span className="text-red-500">*</span>
                </span>
                <input
                  type="tel"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent w-full"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Enter your contact number"
                  required
                  aria-required="true"
                />
              </label>

              <label className="block">
                <span className="text-gray-700 font-medium">
                  Email <span className="text-red-500">*</span>
                </span>
                <input
                  type="email"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent w-full"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                  required
                  aria-required="true"
                />
              </label>
              
              <label className="block sm:col-span-2">
                <span className="text-gray-700 font-medium">Problem Description</span>
                <textarea className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1" value={problemDescription} onChange={(e) => setProblemDescription(e.target.value)} placeholder="Describe your concerns if you want"></textarea>
              </label>

              <label className="block sm:col-span-2">
                <span className="text-gray-700 font-medium">
                  Preferred Time <span className="text-red-500">*</span>
                </span>
                <input
                  type="datetime-local"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent w-full"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                  min={new Date().toISOString().slice(0, 16)}
                  required
                  aria-required="true"
                />
              </label>
            </form>

            <div className="flex flex-col sm:flex-row justify-end gap-3 mt-6">
              <button
                className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition w-full sm:w-auto hover:transition font-medium shadow-sm hover:shadow-lg cursor-pointer"
                onClick={handleClosePopup}
                disabled={loading}
              >
                Cancel
              </button>
              <button
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium w-full sm:w-auto
                hover:transition font-medium shadow-sm hover:shadow-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={confirmBooking}
                disabled={loading}
              >
                {loading ? 'Booking...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* My Bookings Section */}
      <div className="mt-12">
        <h2 className="text-2xl font-bold text-blue-700 mb-6 text-center">My Bookings</h2>
        {myBookings.length === 0 ? (
          <p className="text-gray-500 text-center">You have no bookings yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {myBookings.map(b => (
              <div key={b.id} className="p-4 border rounded-2xl shadow hover:shadow-lg transition bg-white">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-800">{b.counsellorName}</h3>
                    <p className="text-gray-600">📧 {b.email}</p>
                    <p className="text-gray-600">📞 {b.contact}</p>
                    {/* <p className="text-sm text-gray-500 mt-1">
                      Booked by: {b.userName}
                    </p> */}
                  </div>
                  <div className="text-right">
                    <p className="text-gray-600">
                      ⏰ {b.time ? new Date(b.time).toLocaleString() : '—'}
                    </p>
                    <span className={`mt-2 inline-block px-3 py-1 rounded-full text-sm font-medium ${
                      b.status === "booked" ? "bg-blue-100 text-blue-700" :
                      b.status === "completed" ? "bg-green-100 text-green-700" :
                      "bg-gray-100 text-gray-700"
                    }`}>
                      {b.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );  
}