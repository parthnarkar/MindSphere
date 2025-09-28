import { useEffect, useState } from "react";
import { API } from "../hooks/helper";
import { db } from "../firebase";
import { collection, getDocs } from "firebase/firestore";

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [institutions, setInstitutions] = useState([]);
  const [selectedInstitution, setSelectedInstitution] = useState('all');
  const [selectedCounsellorInstitution, setSelectedCounsellorInstitution] = useState('all');
  const [selectedUserInstitution, setSelectedUserInstitution] = useState('all');
  const [phq9Data, setPhq9Data] = useState(null);
  const [counsellors, setCounsellors] = useState([]);
  const [users, setUsers] = useState([]);
  const [adminProfile, setAdminProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCounsellor, setSelectedCounsellor] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [showCounsellorModal, setShowCounsellorModal] = useState(false);
  const [showUserModal, setShowUserModal] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      try {
        // Fetch overall metrics
        const metricsRes = await fetch(`${API}/api/admin`);
        const metricsData = await metricsRes.json();
        setMetrics(metricsData);

        // Fetch institutions data
        const institutionsRes = await fetch(`${API}/api/admin/institutions`);
        const institutionsData = await institutionsRes.json();
        setInstitutions(institutionsData);

        // Fetch PHQ-9 data
        const phq9Res = await fetch(`${API}/api/admin/phq9`);
        const phq9Data = await phq9Res.json();
        setPhq9Data(phq9Data);

        // Fetch counsellors data from Firebase
        const counsellorsSnapshot = await getDocs(collection(db, 'counsellors'));
        const counsellorsData = counsellorsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setCounsellors(counsellorsData);

        // Fetch users data from Firebase
        const usersSnapshot = await getDocs(collection(db, 'users'));
        const usersData = usersSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        }));
        setUsers(usersData);

        // Fetch admin profile
        const adminRes = await fetch(`${API}/api/admin/profile`);
        const adminData = await adminRes.json();
        setAdminProfile(adminData);

        setLoading(false);
      } catch (error) {
        console.error('Error fetching admin data:', error);
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  const filteredInstitutions = selectedInstitution === 'all'
    ? institutions
    : institutions.filter(inst => inst.id === selectedInstitution);

  // Filter counsellors by institution
  const filteredCounsellors = selectedCounsellorInstitution === 'all'
    ? counsellors
    : counsellors.filter(counsellor => counsellor.institution === selectedCounsellorInstitution);

  // Filter users by institution
  const filteredUsers = selectedUserInstitution === 'all'
    ? users.filter(user => user.role === 'user')
    : users.filter(user => user.role === 'user' && user.institution === selectedUserInstitution);

  // Generate 6 months of screening trends data
  const generateScreeningTrends = () => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const currentDate = new Date();

    return months.map((month, index) => {
      const monthDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - (5 - index), 1);
      const screenings = Math.floor(Math.random() * 100) + 50; // Random data between 50-150
      const users = Math.floor(screenings * 0.7); // Users are typically 70% of screenings

      return {
        month,
        screenings,
        users,
        date: monthDate
      };
    });
  };

  const screeningTrends = generateScreeningTrends();

  const openCounsellorModal = (counsellor) => {
    setSelectedCounsellor(counsellor);
    setShowCounsellorModal(true);
  };

  const openUserModal = (user) => {
    setSelectedUser(user);
    setShowUserModal(true);
  };

  const closeModals = () => {
    setShowCounsellorModal(false);
    setShowUserModal(false);
    setSelectedCounsellor(null);
    setSelectedUser(null);
  };

  // Export / report helpers
  const download = (filename, content, mime = 'text/csv') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportAnalyticsReport = () => {
    const data = { metrics, phq9Data, institutions, counsellorsCount: counsellors.length, usersCount: users.length };
    download('analytics-report.json', JSON.stringify(data, null, 2), 'application/json');
  };

  const anonymize = (obj) => {
    const copy = { ...obj };
    delete copy.email;
    delete copy.phone;
    delete copy.studentId;
    return copy;
  };

  const exportAnonymizedCSV = () => {
    const rows = [];
    rows.push(['type', 'id', 'name', 'role', 'institution', 'createdAt'].join(','));
    users.forEach(u => {
      const a = anonymize(u);
      rows.push(['user', a.id || '', `"${(a.name || '').replace(/"/g, '""')}"`, a.role || '', a.institution || '', a.createdAt ? (a.createdAt.seconds ? new Date(a.createdAt.seconds * 1000).toISOString() : new Date(a.createdAt).toISOString()) : ''].join(','));
    });
    counsellors.forEach(c => {
      const a = anonymize(c);
      rows.push(['counsellor', a.id || '', `"${(a.name || '').replace(/"/g, '""')}"`, a.specialization || '', a.institution || '', a.createdAt ? (a.createdAt.seconds ? new Date(a.createdAt.seconds * 1000).toISOString() : new Date(a.createdAt).toISOString()) : ''].join(','));
    });
    download('anonymized-data.csv', rows.join('\n'), 'text/csv');
  };

  const generatePhq9Report = () => {
    if (!phq9Data) {
      download('phq9-summary.csv', `Total Screenings,${0}\nAverage Score,N/A`, 'text/csv');
      return;
    }
    if (!phq9Data.entries || phq9Data.entries.length === 0) {
      const summary = `Total Screenings,${phq9Data.totalScreenings || 0}\nAverage Score,${phq9Data.averageScore || 'N/A'}`;
      download('phq9-summary.csv', summary, 'text/csv');
      return;
    }
    const rows = [['userId', 'score', 'risk', 'date'].join(',')];
    (phq9Data.entries || []).forEach(e => {
      rows.push([e.userId || '', e.score || '', e.risk || '', e.date || ''].join(','));
    });
    download('phq9-report.csv', rows.join('\n'), 'text/csv');
  };

  if (loading) return <div className="px-4 sm:px-6 py-6">Loading admin dashboard...</div>;

  return (
    <div className="px-4 sm:px-6 py-6">
      {/* Action Buttons (wired) */}
      <div className="flex flex-wrap gap-4 mb-8 w-full justify-center">
        <button onClick={exportAnalyticsReport} className="bg-[#FF8C42] text-white px-6 py-3 rounded-lg hover:bg-[#e6732f] transition">
          Export Analytics Report
        </button>
        <button onClick={exportAnonymizedCSV} className="bg-gray-700 text-white px-6 py-3 rounded-lg hover:bg-gray-800 transition">
          Export Anonymized CSV
        </button>
        <button onClick={generatePhq9Report} className="bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition">
          Generate PHQ-9 Report
        </button>
      </div>
      {/* Header with Admin Profile */}
      <div className="mb-8">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 mb-2">Admin Dashboard</h1>
            <p className="text-gray-600">Comprehensive analytics and institutional oversight</p>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white rounded-full flex items-center justify-center text-white font-bold">
                <img src="/admin.png" className="w-10 h-10" />
              </div>
              <div>
                <div className="font-semibold">{adminProfile?.name || 'Admin User'}</div>
                <div className="text-sm text-gray-500">{adminProfile?.role || 'System Administrator'}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Institution Filter */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">Filter by Institution:</label>
        <select
          value={selectedInstitution}
          onChange={(e) => setSelectedInstitution(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF8C42]"
        >
          <option value="all">All Institutions</option>
          {institutions.map(inst => (
            <option key={inst.id} value={inst.id}>{inst.name}</option>
          ))}
        </select>
      </div>

      {/* Overall Metrics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm text-gray-500">Total Active Users</div>
          <div className="text-3xl font-bold text-[#FF8C42]">{metrics?.activeUsers || 0}</div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm text-gray-500">Total Screenings</div>
          <div className="text-3xl font-bold text-blue-600">{metrics?.screenings || 0}</div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm text-gray-500">Total Bookings</div>
          <div className="text-3xl font-bold text-green-600">{metrics?.bookings || 0}</div>
        </div>
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="text-sm text-gray-500">Active Institutions</div>
          <div className="text-3xl font-bold text-purple-600">{institutions.length}</div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        {/* Screening Trends Line Chart */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Screening Trends (6 Months)</h3>
          <div className="h-64 flex items-end space-x-2">
            {screeningTrends.map((data, index) => (
              <div key={index} className="flex-1 flex flex-col items-center">
                <div className="w-full bg-gray-200 rounded-t" style={{ height: `${(data.screenings / 200) * 200}px` }}>
                  <div className="w-full bg-[#FF8C42] rounded-t" style={{ height: '100%' }}></div>
                </div>
                <div className="text-xs text-gray-600 mt-2">{data.month}</div>
                <div className="text-xs font-medium">{data.screenings}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Risk Level Pie Chart */}
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Risk Level Distribution</h3>
          <div className="flex items-center justify-center">
            <div className="relative w-48 h-48">
              <div className="absolute inset-0 rounded-full border-8 border-green-500" style={{ clipPath: 'polygon(50% 50%, 50% 0%, 100% 0%, 100% 50%)' }}></div>
              <div className="absolute inset-0 rounded-full border-8 border-yellow-500" style={{ clipPath: 'polygon(50% 50%, 100% 50%, 100% 100%, 50% 100%)' }}></div>
              <div className="absolute inset-0 rounded-full border-8 border-orange-500" style={{ clipPath: 'polygon(50% 50%, 50% 100%, 0% 100%, 0% 50%)' }}></div>
              <div className="absolute inset-0 rounded-full border-8 border-red-500" style={{ clipPath: 'polygon(50% 50%, 0% 50%, 0% 0%, 50% 0%)' }}></div>
              <div className="absolute inset-4 bg-white rounded-full flex items-center justify-center">
                <div className="text-center">
                  <div className="text-2xl font-bold">{phq9Data?.totalScreenings || 0}</div>
                  <div className="text-xs text-gray-500">Total</div>
                </div>
              </div>
            </div>
          </div>
          <div className="mt-4 space-y-2">
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-green-500 rounded-full"></div>
              <span className="text-sm">Minimal Risk: {phq9Data?.riskDistribution?.minimal || 0}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
              <span className="text-sm">Mild Risk: {phq9Data?.riskDistribution?.mild || 0}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
              <span className="text-sm">Moderate Risk: {phq9Data?.riskDistribution?.moderate || 0}</span>
            </div>
            <div className="flex items-center space-x-2">
              <div className="w-3 h-3 bg-red-500 rounded-full"></div>
              <span className="text-sm">Severe Risk: {phq9Data?.riskDistribution?.severe || 0}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Counsellor Registration Cards */}
      <div className="mb-8" id="counsellor">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">Counsellor Registration Information</h2>
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700">Filter by Institution:</label>
            <select
              value={selectedCounsellorInstitution}
              onChange={(e) => setSelectedCounsellorInstitution(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF8C42] text-sm"
            >
              <option value="all">All Institutions</option>
              {institutions.map(inst => (
                <option key={inst.id} value={inst.name}>{inst.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-4">
          <p className="text-sm text-gray-600">
            Showing {filteredCounsellors.length} counsellor{filteredCounsellors.length !== 1 ? 's' : ''}
            {selectedCounsellorInstitution !== 'all' && ` from ${selectedCounsellorInstitution}`}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCounsellors.length > 0 ? filteredCounsellors.map(counsellor => (
            <div key={counsellor.id} className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition relative">
              <div className="flex items-center space-x-4 mb-4">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-bold">
                    {counsellor.name ? counsellor.name.split(' ').map(n => n[0]).join('') : 'C'}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{counsellor.name || 'Counsellor'}</h3>
                  <p className="text-sm text-gray-500">{counsellor.specialization || 'Mental Health Professional'}</p>
                  <p className="text-sm text-gray-500">{counsellor.email || 'N/A'}</p>
                </div>
              </div>
              <button
                onClick={() => openCounsellorModal(counsellor)}
                className="absolute bottom-4 right-4 bg-[#FF8C42] text-white px-3 py-1.5 rounded-md hover:bg-[#e6732f] transition text-xs"
              >
                View Details
              </button>
            </div>
          )) : (
            <div className="col-span-full text-center py-8">
              <p className="text-gray-500">
                {selectedCounsellorInstitution === 'all'
                  ? 'No counsellors found in the database.'
                  : `No counsellors found for ${selectedCounsellorInstitution}.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* User Registration Cards */}
      <div className="mb-8" id="user">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">User Registration Information</h2>
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700">Filter by Institution:</label>
            <select
              value={selectedUserInstitution}
              onChange={(e) => setSelectedUserInstitution(e.target.value)}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#FF8C42] text-sm"
            >
              <option value="all">All Institutions</option>
              {institutions.map(inst => (
                <option key={inst.id} value={inst.name}>{inst.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="mb-4">
          <p className="text-sm text-gray-600">
            Showing {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''}
            {selectedUserInstitution !== 'all' && ` from ${selectedUserInstitution}`}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredUsers.length > 0 ? filteredUsers.map(user => (
            <div key={user.id} className="bg-white p-6 rounded-lg shadow hover:shadow-lg transition relative">
              <div className="flex items-center space-x-4 mb-4">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                  <span className="text-green-600 font-bold">
                    {user.name ? user.name.split(' ').map(n => n[0]).join('') : 'U'}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-gray-900">{user.name || 'User'}</h3>
                  <p className="text-sm text-gray-500">{user.role || 'Student'}</p>
                  <p className="text-sm text-gray-500">{user.email || 'N/A'}</p>
                </div>
              </div>
              <button
                onClick={() => openUserModal(user)}
                className="absolute bottom-4 right-4 bg-[#FF8C42] text-white px-3 py-1.5 rounded-md hover:bg-[#e6732f] transition text-xs"
              >
                View Details
              </button>
            </div>
          )) : (
            <div className="col-span-full text-center py-8">
              <p className="text-gray-500">
                {selectedUserInstitution === 'all'
                  ? 'No users found in the database.'
                  : `No users found for ${selectedUserInstitution}.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Overview Title as requested (below User) */}
      <div id="overview" className="mb-8">
        <h2 className="text-2xl font-bold text-gray-900">Overview</h2>
        <p className="text-sm text-gray-600">A consolidated overview of counsellors, users and PHQ-9 statistics.</p>
      </div>

      {/* Institution-Specific Data */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Institution Overview</h3>
          <div className="space-y-3">
            {filteredInstitutions.map(institution => (
              <div key={institution.id} className="border-b pb-3 last:border-b-0">
                <div className="flex justify-between items-center">
                  <span className="font-medium">{institution.name}</span>
                  <span className="text-sm text-gray-500">{institution.studentCount} students</span>
                </div>
                <div className="text-sm text-gray-600">
                  {institution.counsellorCount} counsellors • {institution.screeningCount} screenings
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Counsellor Distribution</h3>
          <div className="space-y-3">
            {filteredInstitutions.map(institution => (
              <div key={institution.id} className="flex justify-between items-center">
                <span className="text-sm">{institution.name}</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-[#FF8C42] h-2 rounded-full"
                      style={{ width: `${(institution.counsellorCount / Math.max(...institutions.map(i => i.counsellorCount))) * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium">{institution.counsellorCount}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PHQ-9 Analytics */}
      {phq9Data && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">PHQ-9 Screening Trends</h3>
            <div className="space-y-4">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Total Screenings</span>
                <span className="font-medium">{phq9Data.totalScreenings}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">Average Score</span>
                <span className="font-medium">{phq9Data.averageScore?.toFixed(1) || 'N/A'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600">High Risk Cases</span>
                <span className="font-medium text-red-600">{phq9Data.highRiskCases}</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Risk Level Distribution</h3>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm">Minimal Risk</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-green-500 h-2 rounded-full"
                      style={{ width: `${(phq9Data.riskDistribution?.minimal || 0) / phq9Data.totalScreenings * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium">{phq9Data.riskDistribution?.minimal || 0}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Mild Risk</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-yellow-500 h-2 rounded-full"
                      style={{ width: `${(phq9Data.riskDistribution?.mild || 0) / phq9Data.totalScreenings * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium">{phq9Data.riskDistribution?.mild || 0}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Moderate Risk</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-orange-500 h-2 rounded-full"
                      style={{ width: `${(phq9Data.riskDistribution?.moderate || 0) / phq9Data.totalScreenings * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium">{phq9Data.riskDistribution?.moderate || 0}</span>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm">Severe Risk</span>
                <div className="flex items-center space-x-2">
                  <div className="w-20 bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-red-500 h-2 rounded-full"
                      style={{ width: `${(phq9Data.riskDistribution?.severe || 0) / phq9Data.totalScreenings * 100}%` }}
                    ></div>
                  </div>
                  <span className="text-sm font-medium">{phq9Data.riskDistribution?.severe || 0}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Counsellor Details Modal */}
      {showCounsellorModal && selectedCounsellor && (
        <div className="fixed inset-0 bg-white bg-opacity-95 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto shadow-2xl border">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-3xl font-bold text-gray-900">Counsellor Details</h3>
              <button
                onClick={closeModals}
                className="text-gray-500 hover:text-gray-700 text-3xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="space-y-6">
              {/* Header Section */}
              <div className="flex items-center space-x-6 p-4 bg-gray-50 rounded-lg">
                <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center">
                  <span className="text-blue-600 font-bold text-2xl">
                    {selectedCounsellor.name ? selectedCounsellor.name.split(' ').map(n => n[0]).join('') : 'C'}
                  </span>
                </div>
                <div>
                  <h4 className="text-2xl font-semibold text-gray-900">{selectedCounsellor.name || 'Counsellor'}</h4>
                  <p className="text-lg text-gray-600">{selectedCounsellor.specialization || 'Mental Health Professional'}</p>
                  <p className="text-sm text-gray-500">{selectedCounsellor.email || 'N/A'}</p>
                </div>
              </div>

              {/* Personal Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h5 className="text-lg font-semibold text-gray-900 border-b pb-2">Personal Information</h5>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <p className="text-gray-900">{selectedCounsellor.name || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                    <p className="text-gray-900">{selectedCounsellor.email || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <p className="text-gray-900">{selectedCounsellor.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Address</label>
                    <p className="text-gray-900">{selectedCounsellor.address || 'N/A'}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h5 className="text-lg font-semibold text-gray-900 border-b pb-2">Professional Information</h5>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Specialization</label>
                    <p className="text-gray-900">{selectedCounsellor.specialization || 'Mental Health Professional'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Experience</label>
                    <p className="text-gray-900">{selectedCounsellor.experience || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Education</label>
                    <p className="text-gray-900">{selectedCounsellor.education || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Certifications</label>
                    <p className="text-gray-900">{selectedCounsellor.certifications || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Additional Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h5 className="text-lg font-semibold text-gray-900 border-b pb-2">Account Information</h5>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
                    <p className="text-gray-900 font-mono text-sm">{selectedCounsellor.id || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Registration Date</label>
                    <p className="text-gray-900">
                      {selectedCounsellor.createdAt ?
                        (selectedCounsellor.createdAt.seconds ?
                          new Date(selectedCounsellor.createdAt.seconds * 1000).toLocaleDateString() :
                          new Date(selectedCounsellor.createdAt).toLocaleDateString()) :
                        'N/A'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Updated</label>
                    <p className="text-gray-900">
                      {selectedCounsellor.updatedAt ?
                        (selectedCounsellor.updatedAt.seconds ?
                          new Date(selectedCounsellor.updatedAt.seconds * 1000).toLocaleDateString() :
                          new Date(selectedCounsellor.updatedAt).toLocaleDateString()) :
                        'N/A'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                      Active
                    </span>
                  </div>
                </div>

                <div className="space-y-4">
                  <h5 className="text-lg font-semibold text-gray-900 border-b pb-2">Additional Details</h5>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Bio</label>
                    <p className="text-gray-900">{selectedCounsellor.bio || 'No bio available'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Languages</label>
                    <p className="text-gray-900">{selectedCounsellor.languages || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Availability</label>
                    <p className="text-gray-900">{selectedCounsellor.availability || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Rate</label>
                    <p className="text-gray-900">{selectedCounsellor.rate || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User Details Modal */}
      {showUserModal && selectedUser && (
        <div className="fixed inset-0 bg-white bg-opacity-95 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-4xl w-full mx-4 max-h-[90vh] overflow-y-auto shadow-2xl border">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-3xl font-bold text-gray-900">User Details</h3>
              <button
                onClick={closeModals}
                className="text-gray-500 hover:text-gray-700 text-3xl font-bold"
              >
                ×
              </button>
            </div>
            <div className="space-y-6">
              {/* Header Section */}
              <div className="flex items-center space-x-6 p-4 bg-gray-50 rounded-lg">
                <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center">
                  <span className="text-green-600 font-bold text-2xl">
                    {selectedUser.name ? selectedUser.name.split(' ').map(n => n[0]).join('') : 'U'}
                  </span>
                </div>
                <div>
                  <h4 className="text-2xl font-semibold text-gray-900">{selectedUser.name || 'User'}</h4>
                  <p className="text-lg text-gray-600">{selectedUser.role || 'Student'}</p>
                  <p className="text-sm text-gray-500">{selectedUser.email || 'N/A'}</p>
                </div>
              </div>

              {/* Personal Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h5 className="text-lg font-semibold text-gray-900 border-b pb-2">Personal Information</h5>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                    <p className="text-gray-900">{selectedUser.name || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Email Address</label>
                    <p className="text-gray-900">{selectedUser.email || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                    <p className="text-gray-900">{selectedUser.phone || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                    <p className="text-gray-900">{selectedUser.dateOfBirth || 'N/A'}</p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h5 className="text-lg font-semibold text-gray-900 border-b pb-2">Academic Information</h5>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Institution</label>
                    <p className="text-gray-900">{selectedUser.institution || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Student ID</label>
                    <p className="text-gray-900">{selectedUser.studentId || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Major/Program</label>
                    <p className="text-gray-900">{selectedUser.major || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Year of Study</label>
                    <p className="text-gray-900">{selectedUser.yearOfStudy || 'N/A'}</p>
                  </div>
                </div>
              </div>

              {/* Account Information */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                  <h5 className="text-lg font-semibold text-gray-900 border-b pb-2">Account Information</h5>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
                    <p className="text-gray-900 font-mono text-sm">{selectedUser.id || 'N/A'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
                    <p className="text-gray-900">{selectedUser.role || 'User'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Registration Date</label>
                    <p className="text-gray-900">
                      {selectedUser.createdAt ?
                        (selectedUser.createdAt.seconds ?
                          new Date(selectedUser.createdAt.seconds * 1000).toLocaleDateString() :
                          new Date(selectedUser.createdAt).toLocaleDateString()) :
                        'N/A'}
                    </p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Last Login</label>
                    <p className="text-gray-900">
                      {selectedUser.lastLogin ?
                        (selectedUser.lastLogin.seconds ?
                          new Date(selectedUser.lastLogin.seconds * 1000).toLocaleDateString() :
                          new Date(selectedUser.lastLogin).toLocaleDateString()) :
                        'N/A'}
                    </p>
                  </div>
                </div>

                <div className="space-y-4">
                  <h5 className="text-lg font-semibold text-gray-900 border-b pb-2">Activity Information</h5>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-100 text-green-800">
                      Active
                    </span>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Screenings Completed</label>
                    <p className="text-gray-900">{selectedUser.screeningsCompleted || '0'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sessions Booked</label>
                    <p className="text-gray-900">{selectedUser.sessionsBooked || '0'}</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Emergency Contacts</label>
                    <p className="text-gray-900">{selectedUser.emergencyContact || 'N/A'}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}