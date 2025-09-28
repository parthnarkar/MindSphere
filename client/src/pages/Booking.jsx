import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import logo from "../assets/mindsphere-logo.png";
import { collection, getDocs, addDoc, serverTimestamp, query, where } from "firebase/firestore";
import { toast } from "react-toastify";

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

  // Fetch counsellors from Firestore
  useEffect(() => {
    const fetchCounsellors = async () => {
      try {
        const querySnapshot = await getDocs(collection(db, "counsellors"));
        setCounsellors(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      } catch (error) {
        console.error("Error fetching counsellors:", error);
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
      }
    };
    fetchMyBookings();
  }, [bookingStatus]); // refresh when new booking is confirmed

  // Open popup
  const handleBookClick = (counsellor) => {
    setSelectedCounsellor(counsellor);
    setShowPopup(true);
    setName("");
    setAnonymous(false);
    setTime("");
    setContact("");
    setEmail("");
    setBookingStatus(null);
  };

  // Confirm booking
  const confirmBooking = async () => {
    if (!time || (!anonymous && !name) || !contact || !email) {
      toast.error("Please fill all required fields!", {
        position: "top-right",
        autoClose: 3000,
        hideProgressBar: false,
        closeOnClick: true,
        pauseOnHover: true,
        draggable: true,
      });
      return;
    }

    try {
      await addDoc(collection(db, "appointments"), {
        userId: auth.currentUser.uid,
        userName: anonymous ? "Anonymous" : name,
        counsellorId: selectedCounsellor.id,
        counsellorName: selectedCounsellor.name,
        time,
        contact,
        email,
        status: "booked",
        createdAt: serverTimestamp(),
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
      setTimeout(() => setShowPopup(false), 2000);
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
    }
  };

  return (
  <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
      <h2 className="text-3xl font-extrabold text-center text-blue-700 mb-6">
        Book a Counsellor
      </h2>

      <p className="text-center text-gray-600 mb-8 max-w-2xl mx-auto">Choose from available counsellors below and pick a time that works for you. You can book anonymously if preferred.</p>

      {/* Counsellor Placards */}
  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6 mb-12">
        {counsellors.map(c => (
          <div key={c.id} className="p-5 border rounded-2xl shadow hover:shadow-xl transition flex flex-col items-center bg-white">
            <img
              src={c.image || logo}
              alt={c.name}
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
              className="mt-4 px-4 py-2 bg-blue-600 text-white font-medium rounded-full hover:bg-blue-700 transition"
              onClick={() => handleBookClick(c)}
              aria-label={`Book with ${c.name}`}
            >
              Book
            </button>
          </div>
        ))}
      </div>

      {/* Booking Popup */}
      {showPopup && selectedCounsellor && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-start sm:items-center justify-center z-50 px-4 py-6 sm:py-0">
          <div role="dialog" aria-modal="true" aria-labelledby="book-dialog-title" className="bg-white p-6 rounded-2xl shadow-2xl max-w-xl sm:w-full relative w-full animate-fadeIn">
            <div className="flex items-center gap-3 mb-4">
              <img src={selectedCounsellor.image || logo} onError={(e)=>{e.target.src = logo}} alt={selectedCounsellor.name} className="w-12 h-12 rounded-full object-cover" />
              <div>
                <h3 id="book-dialog-title" className="text-xl font-bold text-blue-700">Book with {selectedCounsellor.name}</h3>
                <div className="text-sm text-gray-600">{selectedCounsellor.specialization}</div>
              </div>
            </div>

            <form className="grid grid-cols-1 sm:grid-cols-2 gap-4"> 
              <div className="sm:col-span-2 flex items-center gap-3">
                <input
                  id="anonymous"
                  type="checkbox"
                  className="w-5 h-5 accent-blue-600"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                <label htmlFor="anonymous" className="text-gray-700 font-medium">Book anonymously</label>
              </div>

              <label className="block sm:col-span-2">
                Your Name
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={anonymous}
                  placeholder="Enter your name"
                />
              </label>

              <label className="block">
                Contact Number
                <input
                  type="tel"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Enter your contact number"
                />
              </label>

              <label className="block">
                Email
                <input
                  type="email"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Enter your email"
                />
              </label>

              <label className="block sm:col-span-2">
                Preferred Time
                <input
                  type="datetime-local"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>


            </form>

            <div className="flex flex-col sm:flex-row justify-end gap-3 mt-6">
              <button
                className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition w-full sm:w-auto"
                onClick={() => setShowPopup(false)}
              >
                Cancel
              </button>
              <button
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium w-full sm:w-auto"
                onClick={confirmBooking}
              >
                Confirm
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
                  </div>
                  <div className="text-right">
                    <p className="text-gray-600">⏰ {b.time ? new Date(b.time).toLocaleString() : '—'}</p>
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
