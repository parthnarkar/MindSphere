import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import { collection, getDocs, addDoc, serverTimestamp, query, where } from "firebase/firestore";

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
      alert("Please fill all required fields!");
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
      setBookingStatus("success");
      setTimeout(() => setShowPopup(false), 1500);
    } catch (error) {
      console.error("Booking failed:", error);
      setBookingStatus("error");
    }
  };

  return (
    <div className="max-w-5xl mx-auto py-8">
      <h2 className="text-3xl font-extrabold text-center text-blue-700 mb-8">
        Book a Counsellor
      </h2>

      {/* Counsellor Placards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
        {counsellors.map(c => (
          <div key={c.id} className="p-5 border rounded-3xl shadow-lg hover:shadow-xl transition flex flex-col items-center bg-white">
            {c.image && <img src={c.image} alt={c.name} className="w-24 h-24 rounded-full mb-3 border-2 border-blue-100" />}
            <h3 className="text-xl font-semibold text-gray-800">{c.name}</h3>
            <p className="text-gray-600">{c.specialization}</p>
            <p className="text-gray-500 text-sm">{c.email}</p>
            <p className="text-gray-500 text-sm">{c.phone}</p>
            <button
              className="mt-4 px-5 py-2 bg-blue-600 text-white font-medium rounded-full hover:bg-blue-700 transition"
              onClick={() => handleBookClick(c)}
            >
              Book
            </button>
          </div>
        ))}
      </div>

      {/* Booking Popup */}
      {showPopup && selectedCounsellor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-4">
          <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-md w-full relative animate-fadeIn">
            <h3 className="text-2xl font-bold text-blue-700 mb-5 text-center">
              Book with {selectedCounsellor.name}
            </h3>

            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-blue-600"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                />
                <label className="text-gray-700 font-medium">Book anonymously</label>
              </div>

              <label className="block">
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

              <label className="block">
                Preferred Time
                <input
                  type="datetime-local"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 mt-1 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent"
                  value={time}
                  onChange={(e) => setTime(e.target.value)}
                />
              </label>

              {bookingStatus === "success" && <p className="text-green-600 font-medium">Booking confirmed! ✅</p>}
              {bookingStatus === "error" && <p className="text-red-600 font-medium">Booking failed. Try again ❌</p>}
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                className="px-4 py-2 bg-gray-300 rounded-lg hover:bg-gray-400 transition"
                onClick={() => setShowPopup(false)}
              >
                Cancel
              </button>
              <button
                className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium"
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
                <h3 className="text-lg font-semibold text-gray-800">{b.counsellorName}</h3>
                <p className="text-gray-600">📧 {b.email}</p>
                <p className="text-gray-600">📞 {b.contact}</p>
                <p className="text-gray-600">⏰ {new Date(b.time).toLocaleString()}</p>
                <span className={`mt-2 inline-block px-3 py-1 rounded-full text-sm font-medium ${
                  b.status === "booked" ? "bg-blue-100 text-blue-700" :
                  b.status === "completed" ? "bg-green-100 text-green-700" :
                  "bg-gray-100 text-gray-700"
                }`}>
                  {b.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
