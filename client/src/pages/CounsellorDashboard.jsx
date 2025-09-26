import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import { collection, query, where, getDocs } from "firebase/firestore";

const CounsellorDashboard = () => {
  const [appointments, setAppointments] = useState([]);

  useEffect(() => {
    async function fetchAppointments() {
      if (!auth.currentUser) return;

      const q = query(
        collection(db, "appointments"),
        where("counsellorId", "==", auth.currentUser.uid)
      );
      const snapshot = await getDocs(q);
      setAppointments(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }

    fetchAppointments();
  }, []);

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h1 className="text-2xl font-bold text-blue-700 mb-4">Counsellor Dashboard</h1>
      <p className="text-gray-700 mb-4">Welcome Counsellor! 🎉 Here are your appointments:</p>

      {appointments.length === 0 ? (
        <p className="text-gray-500">No appointments yet.</p>
      ) : (
        <ul>
          {appointments.map((appt) => (
            <li key={appt.id} className="mb-2 p-2 border rounded">
              <strong>{appt.userName}</strong> — {new Date(appt.time).toLocaleString()} — Status: {appt.status}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

export default CounsellorDashboard;
