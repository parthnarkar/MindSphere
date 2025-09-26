import React, { useEffect, useState } from "react";
import { db, auth } from "../firebase";
import { collection, query, where, getDocs, doc, getDoc } from "firebase/firestore";

const CounsellorDashboard = () => {
  const [appointments, setAppointments] = useState([]);
  const [counsellor, setCounsellor] = useState(null);
  const [clients, setClients] = useState([]);
  const [clientsLoading, setClientsLoading] = useState(true);
  const [clientsError, setClientsError] = useState(null);

  const [phqData, setPhqData] = useState([]);
  const [phqLoading, setPhqLoading] = useState(true);
  const [phqError, setPhqError] = useState(null);

  const BACKEND = "http://localhost:5000"; // Replace with your backend URL if different

  // Fetch counsellor info
  useEffect(() => {
    const fetchCounsellorInfo = async () => {
      if (!auth.currentUser) return;
      try {
        const docRef = doc(db, "counsellors", auth.currentUser.uid);
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setCounsellor({ id: docSnap.id, ...docSnap.data() });
        }
      } catch (error) {
        console.error("Error fetching counsellor info:", error);
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

  // Fetch clients
  useEffect(() => {
    const fetchClients = async () => {
      setClientsLoading(true);
      try {
        const res = await fetch(`${BACKEND}/api/clients`);
        if (!res.ok) {
          // try to parse JSON error body
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
        setClients(data.clients || []);
      } catch (err) {
        console.error("Error fetching clients:", err);
        setClientsError(err.message || "Failed to load clients");
      } finally {
        setClientsLoading(false);
      }
    };
    fetchClients();
  }, []);

  // Fetch PHQ-9 results
  useEffect(() => {
    const fetchPhqData = async () => {
      setPhqLoading(true);
      try {
        const res = await fetch(`${BACKEND}/api/phq9-results`);
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
        // build a map by email for quick lookup and normalize emails
        const arr = data.results || [];
        const normalized = arr.map(r => ({ ...r, user_email: (r.user_email || "").toLowerCase() }));
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

  const getStatusColor = (status) => {
    switch (status) {
      case "booked": return "bg-blue-100 text-blue-700";
      case "completed": return "bg-green-100 text-green-700";
      case "cancelled": return "bg-red-100 text-red-700";
      default: return "bg-gray-100 text-gray-700";
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <h1 className="text-3xl font-extrabold text-blue-700 mb-6">Counsellor Dashboard</h1>

      {/* Counsellor Info */}
      {counsellor && (
        <div className="bg-white shadow-lg rounded-2xl p-6 mb-10 flex flex-col md:flex-row items-center gap-6">
          {counsellor.image && (
            <img
              src={counsellor.image}
              alt={counsellor.name}
              className="w-32 h-32 rounded-full border-2 border-blue-100"
            />
          )}
          <div className="flex-1">
            <h2 className="text-2xl font-bold text-gray-800">{counsellor.name}</h2>
            <p className="text-gray-600 mb-1">Specialization: {counsellor.specialization}</p>
            <p className="text-gray-600 mb-1">📧 {counsellor.email}</p>
            <p className="text-gray-600">📞 {counsellor.phone}</p>
          </div>
        </div>
      )}

      {/* Booking Appointments Section */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-blue-700 mb-4">Booking Appointments</h2>
        {appointments.length === 0 ? (
          <p className="text-gray-500 text-center py-10 text-lg">No booked appointments yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {appointments.map((appt) => (
              <div
                key={appt.id}
                className="bg-white shadow-lg rounded-2xl p-5 hover:shadow-2xl transition duration-300"
              >
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-xl font-semibold text-gray-800">{appt.userName}</h3>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(appt.status)}`}>
                    {appt.status}
                  </span>
                </div>
                <div className="text-gray-600 text-sm space-y-1">
                  {appt.email && <p>📧 {appt.email}</p>}
                  {appt.contact && <p>📞 {appt.contact}</p>}
                  <p>⏰ {new Date(appt.time).toLocaleString()}</p>
                  {appt.createdAt && (
                    <p className="text-gray-400 text-xs">
                      Booked on: {appt.createdAt.toDate().toLocaleString()}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Clients Section with PHQ-9 Scores */}
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-blue-700 mb-4">Submitted Clients</h2>

        {clientsLoading || phqLoading ? (
          <p className="text-gray-600">Loading clients and PHQ-9 data...</p>
        ) : clientsError || phqError ? (
          <p className="text-red-600">
            Error: {clientsError || phqError}
          </p>
        ) : clients.length === 0 ? (
          <p className="text-gray-500 text-center py-6">No clients submitted yet.</p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {clients.map((c) => {
              const email = (c.email || "").toLowerCase();
              const phq = phqData.find(p => p.user_email === email);
              return (
                <div key={c.id} className="bg-white shadow-lg rounded-2xl p-5 hover:shadow-2xl transition duration-300">
                  <h3 className="text-xl font-semibold text-gray-800 mb-1">{c.name || c.fullName || 'Anonymous'}</h3>
                  {c.email && <p className="text-sm text-gray-600 mb-1">📧 {c.email}</p>}
                  {c.phone && <p className="text-sm text-gray-600 mb-1">📞 {c.phone}</p>}
                  {phq && (
                    <p className="text-sm text-gray-700 mt-2">
                      PHQ-9 Score: {phq.totalScore} ({phq.severity})
                    </p>
                  )}
                  {c.details && <p className="text-sm text-gray-700 mt-2">{c.details}</p>}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default CounsellorDashboard;
