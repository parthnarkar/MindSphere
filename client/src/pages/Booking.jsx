import React, { useEffect, useState } from "react";
import { db } from "../firebase";
import { collection, getDocs, addDoc, serverTimestamp } from "firebase/firestore";
import { auth } from "../firebase";

const Booking = () => {
  const [name, setName] = useState("");
  const [time, setTime] = useState("");
  const [ok, setOk] = useState(null);
  const [counsellors, setCounsellors] = useState([]);

  useEffect(() => {
    async function fetchCounsellors() {
      const querySnapshot = await getDocs(collection(db, "counsellors"));
      setCounsellors(querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }
    fetchCounsellors();
  }, []);

  // Booking function for a specific counsellor
  const book = async (counsellorId) => {
    try {
      await addDoc(collection(db, "appointments"), {
        userId: auth.currentUser.uid,
        userName: name || "Anonymous",
        counsellorId,
        time,
        status: "booked",
        createdAt: serverTimestamp(),
      });
      setOk(true);
      setName("");
      setTime("");
    } catch (error) {
      console.error("Booking failed:", error);
      setOk(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8">
      <h2 className="text-2xl font-bold text-center mb-6">Confidential Counseling Booking</h2>
      
      {/* Counsellor Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {counsellors.map(c => (
          <div key={c.id} className="bg-white shadow rounded-lg p-6 flex flex-col items-center">
            <div className="text-xl font-bold text-blue-700 mb-2">{c.name}</div>
            <div className="text-gray-700 mb-1">{c.specialization}</div>
            <div className="text-sm text-gray-500 mb-2">{c.email}</div>
            <button
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700"
              onClick={() => book(c.id)}
            >
              Book
            </button>
          </div>
        ))}
      </div>

      {/* Booking Form */}
      <div className="bg-white shadow rounded-lg p-6 mx-auto max-w-md">
        <label className="block font-semibold mb-2">
          Preferred name (anonymous ok)
          <input
            className="w-full border rounded px-3 py-2 mb-4"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>

        <label className="block font-semibold mb-2">
          Preferred time
          <input
            className="w-full border rounded px-3 py-2 mb-4"
            type="datetime-local"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </label>

        {ok && <div className="mt-3 text-sm text-green-700">Booking requested successfully!</div>}
        {ok === false && <div className="mt-3 text-sm text-red-700">Failed to request booking.</div>}
      </div>
    </div>
  );
};

export default Booking;
