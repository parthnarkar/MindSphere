import React from "react";

const CounsellorDashboard = () => {
  return (
    <div className="bg-white shadow rounded-lg p-6">
      <h1 className="text-2xl font-bold text-blue-700 mb-4">
        Counsellor Dashboard
      </h1>
      <p className="text-gray-700">
        Welcome Counsellor! 🎉 Here you can view appointments, manage clients, and update your profile.
      </p>
      {/* Add more components like Appointments, Clients list, etc. */}
    </div>
  );
};

export default CounsellorDashboard;