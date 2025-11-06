import { useEffect, useMemo, useState } from "react";
import { db, auth } from "../services/firebase";
import {
  collection,
  query as fsQuery,
  where,
  onSnapshot,
  doc,
  getDoc,
} from "firebase/firestore";
import { onAuthStateChanged } from "firebase/auth";

export default function AdminDashboard() {
  const [metrics, setMetrics] = useState(null);
  const [counsellors, setCounsellors] = useState([]);
  const [appointments, setAppointments] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [users, setUsers] = useState([]);
  const [usersOnly, setUsersOnly] = useState([]);
  const [adminProfile, setAdminProfile] = useState(null);

  // Real-time admin profile (kept in a separate state if we want to show
  // live updates from Firestore). We'll use a ProfileCard component below
  // that subscribes to the `users` collection where role === 'admin' or to
  // a specific admin doc if available.

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // UI state
  const [query, setQuery] = useState("");
  // institution-related filters removed per request
  const [selectedCounsellor, setSelectedCounsellor] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [selectedAppointmentCounsellor, setSelectedAppointmentCounsellor] =
    useState("all");
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState(null);
  const [genStatus, setGenStatus] = useState("");

  // Helpers to open details and fetch related profile from `profiles/{uid}` collection
  const openUserDetails = async (user) => {
    // set selected user id; the users/{id} document will be subscribed to in a useEffect
    setSelectedUser({ id: user.id });
  };

  const openCounsellorDetails = async (c) => {
    // set selected counsellor; profile will be subscribed to in a separate useEffect
    setSelectedCounsellor(c);
  };

  // Subscribe to users/{uid} in real-time while a user modal is open
  useEffect(() => {
    if (!selectedUser?.id) return;
    const uRef = doc(db, "users", selectedUser.id);
    const unsub = onSnapshot(
      uRef,
      (snap) => {
        if (!snap.exists()) {
          // document removed
          setSelectedUser(null);
          return;
        }
        setSelectedUser({ id: snap.id, ...snap.data() });
      },
      (e) => {
        console.error("users snapshot error (user modal):", e);
      }
    );

    return () => {
      try {
        unsub();
      } catch (e) {}
    };
  }, [selectedUser?.id]);

  // Subscribe to profiles/{uid} in real-time while a counsellor modal is open
  useEffect(() => {
    if (!selectedCounsellor?.id) return;
    // subscribe to the `counsellors` collection document for this counsellor id
    const cRef = doc(db, "counsellors", selectedCounsellor.id);
    const unsub = onSnapshot(
      cRef,
      (snap) => {
        if (!snap.exists()) {
          // if counsellor doc not present in counsellors collection, keep existing selectedCounsellor
          return;
        }
        // replace selectedCounsellor with live data from counsellors/{id}
        setSelectedCounsellor({ id: snap.id, ...snap.data() });
      },
      (e) => {
        console.error("counsellors snapshot error (counsellor):", e);
      }
    );

    return () => {
      try {
        unsub();
      } catch (e) {}
      // when modal closes, selectedCounsellor will be cleared by caller; do not merge profile data
    };
  }, [selectedCounsellor?.id]);

  useEffect(() => {
    // Single realtime source: users collection. We'll derive everything from users.
    setLoading(true);
    setError(null);
    let unsub = null;

    try {
      unsub = onSnapshot(
        collection(db, "users"),
        (snap) => {
          const all = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          // Keep the full snapshot but also derive a users-only list (role === 'user')
          setUsers(all);
          const usersList = all.filter(
            (u) => (u.role || "").toLowerCase() === "user"
          );
          setUsersOnly(usersList);

          // Derive counsellors, admins, institutions
          const counsellorsList = all.filter(
            (u) => (u.role || "").toLowerCase() == "counsellor"
          );
          const adminsList = all.filter(
            (u) => (u.role || "").toLowerCase() == "admin"
          );
          setCounsellors(counsellorsList);
          setAdminProfile(adminsList[0] || null);

          // Metrics: simple derivations from users docs
          const usersCount = usersList.length;

          setMetrics({
            activeUsers: all.length,
            usersCount: usersCount,
            counsellorsCount: counsellorsList.length,
          });

          setLoading(false);
          try {
            window.dispatchEvent(new CustomEvent("mindsphere:pageReady"));
          } catch (e) {}
        },
        (e) => {
          console.error("users snapshot error", e);
          setError(e.message || String(e));
          setLoading(false);
        }
      );
    } catch (e) {
      console.error("setup users listener error", e);
      setError(String(e));
      setLoading(false);
    }

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  // Subscribe to appointments collection in real-time
  useEffect(() => {
    let unsub = null;
    try {
      unsub = onSnapshot(
        collection(db, "appointments"),
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setAppointments(arr);
        },
        (e) => {
          console.error("appointments snapshot error", e);
        }
      );
    } catch (e) {
      console.error("setup appointments listener error", e);
    }

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  // Subscribe to profiles collection in real-time and keep as an array
  useEffect(() => {
    let unsub = null;
    try {
      unsub = onSnapshot(
        collection(db, "profiles"),
        (snap) => {
          const arr = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
          setProfiles(arr);
        },
        (e) => {
          console.error("profiles snapshot error", e);
        }
      );
    } catch (e) {
      console.error("setup profiles listener error", e);
    }

    return () => {
      if (typeof unsub === "function") unsub();
    };
  }, []);

  // Derived lists
  const visibleCounsellors = useMemo(() => {
    // No institution filtering — show all counsellors, filter only by query
    if (!query) return counsellors;
    const q = query.toLowerCase();
    return counsellors.filter(
      (c) =>
        (c.name || "").toLowerCase().includes(q) ||
        (c.email || "").toLowerCase().includes(q)
    );
  }, [counsellors, query]);

  const visibleUsers = useMemo(() => {
    const onlyUsers = usersOnly; // derived from snapshot, guaranteed role==='user'
    // No institution filtering — filter only by query
    if (!query) return onlyUsers;
    const q = query.toLowerCase();
    return onlyUsers.filter(
      (u) =>
        (u.name || "").toLowerCase().includes(q) ||
        (u.email || "").toLowerCase().includes(q)
    );
  }, [usersOnly, query]);

  // Utilities
  const download = (filename, content, mime = "application/json") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // anonymize and analytics CSV exporter removed — not used in the current UI

  // Per-section report exporters (CSV)
  const exportUserReport = () => {
    // Export full users documents (include all fields). We do NOT anonymize here
    // because this per-section report is intended to include all stored fields.
    const records = (visibleUsers || []).map((r) => ({ ...r }));
    const csv = recordsToCsv(records);
    download("user-report.csv", csv, "text/csv;charset=utf-8;");
  };

  const exportCounsellorReport = async () => {
    // For counsellors we fetch the authoritative documents from the
    // `counsellors` collection (if present) so that exported CSV contains
    // all fields stored there. If a counsellor doc isn't present, fall back
    // to the derived visibleCounsellors entry.
    try {
      const ids = (visibleCounsellors || []).map((c) => c.id).filter(Boolean);
      const docs = await Promise.all(
        ids.map((id) => getDoc(doc(db, "counsellors", id)))
      );
      const records = docs
        .map((snap, idx) => {
          if (snap && snap.exists && snap.exists())
            return { id: snap.id, ...snap.data() };
          // fallback to the visibleCounsellors entry if no counsellor doc exists
          return visibleCounsellors[idx] || null;
        })
        .filter(Boolean);

      const csv = recordsToCsv(records);
      download("counsellor-report.csv", csv, "text/csv;charset=utf-8;");
    } catch (e) {
      console.error("exportCounsellorReport error", e);
      // fallback: export the visible counsellors as a best-effort
      const fallbackRecords = (visibleCounsellors || []).map((r) => ({ ...r }));
      const csv = recordsToCsv(fallbackRecords);
      download("counsellor-report.csv", csv, "text/csv;charset=utf-8;");
    }
  };

  // Utility: flatten nested objects into dot-notated keys
  const flattenObject = (obj = {}, prefix = "") => {
    const out = {};
    Object.keys(obj || {}).forEach((k) => {
      const val = obj[k];
      const key = prefix ? `${prefix}.${k}` : k;
      if (
        val &&
        typeof val === "object" &&
        !Array.isArray(val) &&
        !(val instanceof Date)
      ) {
        const nested = flattenObject(val, key);
        Object.assign(out, nested);
      } else {
        out[key] = val;
      }
    });
    return out;
  };

  // Utility: convert array of records (objects) to CSV string with header union
  const recordsToCsv = (records = []) => {
    if (!records || records.length === 0) return "";
    // flatten each record and collect headers
    const flat = records.map((r) => flattenObject(r));
    const headerSet = new Set();
    // ensure id, name, email, role, institution come first if present
    const preferred = [
      "id",
      "name",
      "email",
      "role",
      "institution",
      "createdAt",
    ];
    flat.forEach((f) => Object.keys(f).forEach((k) => headerSet.add(k)));
    const otherHeaders = Array.from(headerSet)
      .filter((h) => !preferred.includes(h))
      .sort();
    const headers = [
      ...preferred.filter((h) => headerSet.has(h)),
      ...otherHeaders,
    ];

    const escape = (v) => {
      if (v === null || v === undefined) return "";
      if (typeof v === "object")
        return `"${JSON.stringify(v).replace(/"/g, '""')}"`;
      const s = String(v);
      // wrap in quotes and escape inner quotes
      return `"${s.replace(/"/g, '""')}"`;
    };

    const rows = [headers.join(",")];
    flat.forEach((f) => {
      const row = headers.map((h) => {
        // prefer nested key values, but if missing try top-level (already flattened covers both)
        const val = f.hasOwnProperty(h) ? f[h] : "";
        return escape(val);
      });
      rows.push(row.join(","));
    });
    return rows.join("\n");
  };

  // Utility: format field values for display in the details table
  const formatValue = (v) => {
    if (v === null || v === undefined) return "—";
    if (v === "") return "—";
    // Firestore timestamp-like object
    if (typeof v === "object") {
      if (v && typeof v.seconds === "number") {
        try {
          return new Date(v.seconds * 1000).toLocaleString();
        } catch (e) {}
      }
      try {
        return JSON.stringify(v, null, 0);
      } catch (e) {
        return String(v);
      }
    }
    // Try to show date-like strings nicely
    const s = String(v);
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toLocaleString();
    return s;
  };

  // Utility: convert a dot-notated or camelCase key into a human-friendly label
  const prettifyKey = (k) => {
    if (!k) return "";
    // common explicit mappings
    const map = {
      id: "ID",
      createdAt: "Created At",
      updatedAt: "Updated At",
      studentId: "Student ID",
      consultationFee: "Consultation Fee",
      profile: "Profile",
      number: "Phone",
      lastLogin: "Last Login",
      phone: "Phone",
      email: "Email",
      name: "Name",
      specialization: "Specialization",
    };

    // If exact key mapped, return
    if (map[k]) return map[k];

    // Replace dots with spaces, then split camelCase into words
    const withSpaces = k
      .replace(/\./g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/_/g, " ");

    // Capitalize each word
    return withSpaces
      .split(" ")
      .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
      .join(" ");
  };

  // Small presentational subcomponents used only in this file
  const MetricsGrid = ({ metrics }) => (
    <section className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
      <Card label="Users" value={metrics?.usersCount ?? 0} />
      <Card
        label="Counsellors"
        value={metrics?.counsellorsCount ?? 0}
      />
    </section>
  );

  const Card = ({ label, value }) => (
    <div className="bg-white p-4 rounded shadow flex flex-col">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-bold mt-2">{value}</div>
    </div>
  );

  const List = ({ title, items, onView, reportLabel, onReport }) => (
    <div className="bg-white p-4 rounded shadow">
      <div className="flex items-center justify-between mb-3 gap-1">
        <h3 className="text-sm font-medium">
          {title} ({items.length})
        </h3>
        {reportLabel ? (
          <button
            onClick={onReport}
            className="text-xs px-2 py-1 bg-blue-600 text-white rounded border border-blue-700 hover:bg-blue-700 cursor-pointer"
          >
            {reportLabel}
          </button>
        ) : null}
      </div>
      <ul className="space-y-2 text-sm text-gray-700">
        {items.length > 0 ? (
          items.slice(0, 20).map((it) => (
            <li key={it.id} className="flex items-center justify-between">
              <div>
                <div className="font-medium">{it.name || it.email || "—"}</div>
                <div className="text-xs text-gray-500">{it.email || "—"}</div>
              </div>
              <button
                onClick={() => onView(it)}
                className="text-xs text-[#FF8C42] cursor-pointer"
              >
                Details
              </button>
            </li>
          ))
        ) : (
          <li className="text-gray-500">No entries found.</li>
        )}
      </ul>
    </div>
  );

  // Appointments section: compute accepted/rejected counts and render a pie chart.
  const AppointmentsSection = ({
    appointments = [],
    counsellors = [],
    className = "",
  }) => {
    // compute counts grouped by counsellor email from the `appointments` collection docs
    const summaryByEmail = {};

    (appointments || []).forEach((a) => {
      // Attempt several ways to get counsellor email
      const emailFromDoc =
        a?.counsellorEmail ||
        a?.counsellor?.email ||
        a?.providerEmail ||
        a?.therapistEmail ||
        a?.counsellor_email ||
        null;

      // Fallback: try to lookup counsellor by id present on the appointment
      let counsellorEmail = emailFromDoc;
      if (!counsellorEmail) {
        const cid =
          a?.counsellorId ||
          a?.counsellor?.id ||
          a?.counsellorUid ||
          a?.counsellor_id ||
          null;
        if (cid) {
          const found = counsellors.find((c) => c.id === cid || c.uid === cid);
          counsellorEmail = found?.email || null;
        }
      }

      if (!counsellorEmail) counsellorEmail = "unknown";

      const rawStatus = (a?.status || a?.state || "").toString().toLowerCase();
      // detect boolean flags too
      const acceptedFlag = a?.accepted === true || a?.isAccepted === true;
      const rejectedFlag = a?.rejected === true || a?.isRejected === true;

      let status = "other";
      if (
        acceptedFlag ||
        ["accepted", "confirmed", "approved", "yes"].includes(rawStatus)
      )
        status = "accepted";
      else if (
        rejectedFlag ||
        ["rejected", "cancelled", "declined", "no"].includes(rawStatus)
      )
        status = "rejected";

      if (!summaryByEmail[counsellorEmail])
        summaryByEmail[counsellorEmail] = {
          accepted: 0,
          rejected: 0,
          other: 0,
        };
      summaryByEmail[counsellorEmail][status] =
        (summaryByEmail[counsellorEmail][status] || 0) + 1;
    });

    // Build list of counsellor emails to show in dropdown (include known counsellors even if zero)
    const knownEmails = new Set(Object.keys(summaryByEmail));
    (counsellors || []).forEach((c) => {
      if (c?.email) knownEmails.add(c.email);
    });
    const emailOptions = Array.from(knownEmails).sort();

    // compute aggregated totals depending on selector
    const totalsForSelected = useMemo(() => {
      if (selectedAppointmentCounsellor === "all") {
        return Object.values(summaryByEmail).reduce(
          (acc, v) => {
            acc.accepted += v.accepted || 0;
            acc.rejected += v.rejected || 0;
            acc.other += v.other || 0;
            return acc;
          },
          { accepted: 0, rejected: 0, other: 0 }
        );
      }
      const s = summaryByEmail[selectedAppointmentCounsellor] || {
        accepted: 0,
        rejected: 0,
        other: 0,
      };
      return {
        accepted: s.accepted || 0,
        rejected: s.rejected || 0,
        other: s.other || 0,
      };
    }, [JSON.stringify(summaryByEmail), selectedAppointmentCounsellor]);

    // simple name lookup by email
    const counsellorName =
      selectedAppointmentCounsellor === "all"
        ? "All counsellors"
        : counsellors.find((c) => c.email === selectedAppointmentCounsellor)
            ?.name || selectedAppointmentCounsellor;

    return (
      <div className={`bg-white p-2 rounded shadow w-full ${className}`}>
        <div className="flex items-center justify-between my-2 gap-1">
          <h3 className="text-sm font-medium">Appointments</h3>
          <div className="flex items-center gap-1">
            <select
              className="border rounded p-1 text-sm"
              value={selectedAppointmentCounsellor}
              onChange={(e) => setSelectedAppointmentCounsellor(e.target.value)}
            >
              <option value="all">All counsellors</option>
              {emailOptions.map((em) => (
                <option key={em} value={em}>
                  {em === "unknown" ? "Unknown" : em}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-4 p-2 justify-around">
          <div className="flex-1 max-w-[50%] relative p-2">
            <PieChart
              data={{
                accepted: totalsForSelected.accepted,
                rejected: totalsForSelected.rejected,
                other: totalsForSelected.other,
              }}
            />
          </div>

          <div className="text-md text-gray-700 w-full md:w-56 flex justify-center items-start flex-col gap-2 p-2">
            <div className="mb-2 font-medium">{counsellorName}</div>

            {/* Consistent legend: Accepted / Rejected / Other (always shown) */}
            {(() => {
              const t =
                totalsForSelected.accepted +
                totalsForSelected.rejected +
                totalsForSelected.other;
              const pct = (n) => (t ? `${((n / t) * 100).toFixed(1)}%` : "0%");
              return (
                <>
                  {/* Detailed counts (kept for accessibility / layout parity) */}
                  <div className="space-y-1 mb-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-sm"
                          style={{ backgroundColor: "#10b981" }}
                        />
                        <span className="font-medium">Accepted </span>
                      </div>
                      <div className="text-xs text-gray-600 mx-1">
                        {totalsForSelected.accepted} •{" "}
                        {pct(totalsForSelected.accepted)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-sm"
                          style={{ backgroundColor: "#ef4444" }}
                        />
                        <span className="font-medium">Rejected </span>
                      </div>
                      <div className="text-xs text-gray-600 mx-1">
                        {totalsForSelected.rejected} •{" "}
                        {pct(totalsForSelected.rejected)}
                      </div>
                    </div>

                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-block w-3 h-3 rounded-sm"
                          style={{ backgroundColor: "#f59e0b" }}
                        />
                        <span className="font-medium">Other </span>
                      </div>
                      <div className="text-xs text-gray-600 mx-1">
                        {totalsForSelected.other} •{" "}
                        {pct(totalsForSelected.other)}
                      </div>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      </div>
    );
  };

  const InstitutionData = ({ profiles = [], className = "" }) => {
    const [expanded, setExpanded] = useState([]);
    const toggleExpanded = (id) => {
      setExpanded((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
      );
    };
    // Group profiles by institution/school and render a selector + list.
    const bySchool = useMemo(() => {
      const m = {};
      (profiles || []).forEach((p) => {
        const raw =
          p?.school ?? p?.institution ?? p?.org ?? p?.organisation ?? "Unknown";
        const school = String(raw || "Unknown").trim() || "Unknown";
        if (!m[school]) m[school] = [];
        m[school].push(p);
      });
      // produce sorted array by count desc
      const arr = Object.entries(m).map(([school, items]) => ({
        school,
        count: items.length,
        items,
      }));
      arr.sort((a, b) => b.count - a.count);
      return arr;
    }, [profiles]);

    const total = bySchool.reduce((s, g) => s + g.count, 0);
    const [selectedSchool, setSelectedSchool] = useState("all");

    // filtered profiles for display (no free-text filter)
    const displayProfiles = useMemo(() => {
      if (selectedSchool === "all") return profiles || [];
      const bucket = bySchool.find((b) => b.school === selectedSchool);
      return (bucket && bucket.items) || [];
    }, [selectedSchool, bySchool, profiles]);

    if (!bySchool || bySchool.length === 0) return null;

    return (
      <div className={`bg-white p-4 rounded shadow w-full ${className}`}>
        <div className="flex items-center justify-between mb-3 gap-1">
          <div>
            <h3 className="text-sm font-medium">Institutions</h3>
            <div className="text-xs text-gray-500">
              Top institutions by user count
            </div>
          </div>

          <div className="flex items-center gap-2">
            <select
              className="border rounded px-2 py-1 text-sm bg-white"
              value={selectedSchool}
              onChange={(e) => setSelectedSchool(e.target.value)}
            >
              <option value="all">All</option>
              {bySchool.map((b) => (
                <option key={b.school} value={b.school}>
                  {b.school} ({b.count})
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col md:flex-row gap-4 my-2 py-2">
          {/* Left: small bars for top institutions */}
          <div className="flex-1 md:w-1/2">
            <div className="text-sm text-gray-600 my-2">
                Showing {bySchool.length} institutions
              </div>
            <div className="space-y-2 p-2">
              
              {bySchool.map(({ school, count }) => {
                const pct = total ? (count / total) * 100 : 0;
                return (
                  // Flexbox row: reorder for mobile vs desktop using flex order
                  <div
                    key={school}
                    className="flex flex-col sm:flex-row items-center gap-2"
                  >
                    {/* Name: top on mobile, left on desktop */}
                    <div
                      className="order-1 w-full sm:w-20 text-sm text-gray-700 truncate"
                      title={school}
                    >
                      {school}
                    </div>

                    {/* Count: shown next to name on mobile, right on desktop */}
                    <div className="order-2 w-full sm:w-24 text-sm text-gray-600 text-right">
                      <div className="flex justify-between sm:justify-end">
                        <div className="font-medium">{count}</div>
                        <div className="text-xs text-gray-400 sm:ml-2">({pct.toFixed(1)}%)</div>
                      </div>
                    </div>

                    {/* Bar: placed below name/count on mobile (order-3) and between name and count on desktop (sm:order-2) */}
                    <div
                      className="order-3 w-full sm:order-2 sm:flex-1 bg-gray-100 h-4 rounded overflow-hidden"
                      role="img"
                      aria-label={`${count} users — ${pct.toFixed(1)} percent`}
                    >
                      <div
                        className="h-4 rounded bg-gradient-to-r from-blue-500 to-blue-700"
                        style={{ width: `${Math.max(pct, 1)}%` }}
                      />
                    </div>
                  </div>
                );
              })}

              
            </div>
          </div>

          {/* Right: list of users (all or filtered) */}
          <div className="flex-1 md:w-1/2">
            <div className="mb-2 text-sm text-gray-600">
              {selectedSchool === "all"
                ? `Showing all users`
                : `Users in ${selectedSchool}`}
            </div>
            <div className="bg-gray-50 p-2 rounded">
              <div>
                <ul className="text-sm space-y-2">
                {displayProfiles.length > 0 ? (
                  displayProfiles.map((p, i) => {
                    const id = p.id || p.email || `${selectedSchool}-${i}`;
                    const isOpen = expanded.includes(id);
                    return (
                      <li key={id} className="bg-white rounded shadow-sm">
                        <div className="flex items-center justify-between p-2 gap-1">
                          <div className="min-w-0">
                            <div className="font-medium text-sm truncate">
                              {p.name || p.email || "—"}
                            </div>
                            <div className="text-xs text-gray-500 truncate">
                              {p.email || "—"}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="text-xs text-gray-600 m-1 whitespace-nowrap">
                              {p.school || p.institution || "Unknown"}
                            </div>
                            <button
                              onClick={() => toggleExpanded(id)}
                              className="text-xs text-[#FF8C42] cursor-pointer p-1 rounded focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-[#FF8C42]"
                              aria-expanded={isOpen}
                              aria-controls={`profile-${id}`}
                            >
                              {isOpen ? "Less" : "More"}
                            </button>
                          </div>
                        </div>

                        <div
                          id={`profile-${id}`}
                          className={`px-2 transition-all duration-200 overflow-hidden ${
                            isOpen ? "py-2" : "max-h-0"
                          }`}
                        >
                          {isOpen && (
                            <div className="bg-gray-50 p-2 rounded text-xs">
                              {(() => {
                                try {
                                  const flat = flattenObject(p || {});
                                  const keys = Object.keys(flat).sort();
                                  if (keys.length === 0)
                                    return (
                                      <div className="text-gray-500">No fields available.</div>
                                    );

                                  // Desktop: table; Mobile: stacked key/value cards
                                  return (
                                    <>
                                      <table className="hidden md:table w-full table-fixed text-left text-xs">
                                        <tbody>
                                          {keys.map((k) => (
                                            <tr key={k} className="border-b odd:bg-white even:bg-gray-100">
                                              <td className="w-1/3 p-2 text-gray-600 align-top break-words">
                                                {prettifyKey(k)}
                                              </td>
                                              <td className="py-2 align-top break-words">
                                                {formatValue(flat[k])}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>

                                      <div className="md:hidden grid gap-2">
                                        {keys.map((k) => (
                                          <div key={k} className="bg-white p-2 rounded border">
                                            <div className="text-xs text-gray-600 font-medium">{prettifyKey(k)}</div>
                                            <div className="text-xs text-gray-800 mt-1 break-words">{formatValue(flat[k])}</div>
                                          </div>
                                        ))}
                                      </div>
                                    </>
                                  );
                                } catch (e) {
                                  return (
                                    <pre className="bg-gray-50 p-2 rounded text-xs overflow-auto">
                                      {JSON.stringify(p, null, 2)}
                                    </pre>
                                  );
                                }
                              })()}
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })
                ) : (
                  <li className="text-gray-500">No users found.</li>
                )}
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Minimal SVG pie chart (no external deps). Expects numeric values on data.
  function PieChart({ data = { accepted: 0, rejected: 0, other: 0 } }) {
    const { accepted = 0, rejected = 0, other = 0 } = data || {};
    const total = accepted + rejected + other;
    const size = 200; // viewBox base size
    const radius = size / 2;

    const polarToCartesian = (cx, cy, r, angleDeg) => {
      const angleRad = ((angleDeg - 90) * Math.PI) / 180.0;
      return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
    };

    const describeArc = (cx, cy, r, startAngle, endAngle) => {
      if (endAngle - startAngle >= 360) {
        // full circle
        return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
      }
      const start = polarToCartesian(cx, cy, r, endAngle);
      const end = polarToCartesian(cx, cy, r, startAngle);
      const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
      return [
        `M ${cx} ${cy}`,
        `L ${start.x} ${start.y}`,
        `A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`,
        "Z",
      ].join(" ");
    };

    if (!total) {
      return (
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${size} ${size}`}
          preserveAspectRatio="xMidYMid meet"
        >
          <circle cx={radius} cy={radius} r={radius} fill="#f3f4f6" />
          <text
            x="50%"
            y="50%"
            dominantBaseline="middle"
            textAnchor="middle"
            fontSize="10"
            fill="#6b7280"
          >
            No data
          </text>
        </svg>
      );
    }

    const segments = [];
    let angleStart = 0;
    const addSegment = (value, color) => {
      if (!value) return;
      const angle = (value / total) * 360;
      const path = describeArc(
        radius,
        radius,
        radius,
        angleStart,
        angleStart + angle
      );
      segments.push({ path, color });
      angleStart += angle;
    };

    addSegment(accepted, "#10b981");
    addSegment(rejected, "#ef4444");
    addSegment(other, "#f59e0b");

    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${size} ${size}`}
        preserveAspectRatio="xMidYMid meet"
      >
        <circle cx={radius} cy={radius} r={radius} fill="#fff" />
        {segments.map((s, i) => (
          <path
            key={i}
            d={s.path}
            fill={s.color}
            stroke="white"
            strokeWidth="0.5"
          />
        ))}
      </svg>
    );
  }

  if (loading)
    return <div className="px-4 sm:px-6 py-6">Loading admin dashboard...</div>;
  if (error)
    return (
      <div className="p-6 text-red-600">Error loading admin data: {error}</div>
    );

  return (
    <div className="max-w-6xl mx-auto px-4 py-26">
      <header className="my-2 flex items-center justify-between gap-2 py-2">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            Admin Dashboard
          </h1>
          <p className="text-xs text-gray-600">
            Quick overview, filters and export
          </p>
        </div>

        {/* Real-time profile card: subscribes to Firestore and updates live */}
        <div className="flex items-center gap-2">
          <ProfileCard adminId={adminProfile?.id} />
        </div>
      </header>

      <MetricsGrid metrics={metrics} />

      <section className="flex items-center justify-between my-2 py-2 gap-1">
        <div className="flex gap-2 items-center">
          <input
            className="border rounded p-2 text-sm border-blue-400  outline-none"
            placeholder="Search name or email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {/* Generate Report button removed per request */}
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-4 my-2">
        <List
          title="Counsellors"
          items={visibleCounsellors}
          onView={(c) => openCounsellorDetails(c)}
          reportLabel="Export CSV"
          onReport={exportCounsellorReport}
        />
        <List
          title="Users"
          items={visibleUsers}
          onView={(u) => openUserDetails(u)}
          reportLabel="Export CSV"
          onReport={exportUserReport}
        />
      </section>

      <AppointmentsSection
        appointments={appointments}
        counsellors={counsellors}
        className="my-12"
      />

      <InstitutionData profiles={profiles} className="my-12" />

      {/* Counsellor Modal */}
      {selectedCounsellor && (
        <Modal
          onClose={() => setSelectedCounsellor(null)}
          headerTitle={
            selectedCounsellor.name ||
            selectedCounsellor.email ||
            "Counsellor details"
          }
          headerSubtitle={selectedCounsellor.email || ""}
        >
          <div className="text-sm text-gray-700">
            {(() => {
              try {
                const flat = flattenObject(selectedCounsellor || {});
                const keys = Object.keys(flat).sort();

                return (
                  <div>
                    <div className="mb-2 font-medium">All Details</div>
                    <div className="bg-gray-50 p-3 rounded text-xs">
                      <table className="w-full table-fixed text-left text-xs">
                        <tbody>
                          {keys.length > 0 ? (
                            keys.map((k) => (
                              <tr
                                key={k}
                                className="border-b odd:bg-white even:bg-gray-100"
                              >
                                <td className="w-1/3 p-2 text-gray-600 align-top break-words">
                                  {prettifyKey(k)}
                                </td>
                                <td className="py-2 align-top break-words">
                                  {formatValue(flat[k])}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td className="text-gray-500">
                                No fields available.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              } catch (e) {
                return (
                  <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-[40vh] sm:max-h-[60vh]">
                    {JSON.stringify(selectedCounsellor, null, 2)}
                  </pre>
                );
              }
            })()}
          </div>
        </Modal>
      )}

      {/* User Modal */}
      {selectedUser && (
        <Modal
          onClose={() => setSelectedUser(null)}
          headerTitle={
            selectedUser.name || selectedUser.email || "User details"
          }
          headerSubtitle={selectedUser.email || ""}
        >
          <div className="text-sm text-gray-700">
            {(() => {
              try {
                const flat = flattenObject(selectedUser || {});
                const keys = Object.keys(flat).sort();

                return (
                  <div>
                    <div className="mb-2 font-medium">All fields</div>
                    <div className="bg-gray-50 p-3 rounded text-xs">
                      <table className="w-full table-fixed text-left text-xs">
                        <tbody>
                          {keys.length > 0 ? (
                            keys.map((k) => (
                              <tr
                                key={k}
                                className="border-b odd:bg-white even:bg-gray-100"
                              >
                                <td className="w-1/3 p-2 text-gray-600 align-top break-words">
                                  {prettifyKey(k)}
                                </td>
                                <td className="py-2 align-top break-words">
                                  {formatValue(flat[k])}
                                </td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td className="text-gray-500">
                                No fields available.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              } catch (e) {
                return (
                  <pre className="bg-gray-50 p-3 rounded text-xs overflow-auto max-h-[40vh] sm:max-h-[60vh]">
                    {JSON.stringify(selectedUser, null, 2)}
                  </pre>
                );
              }
            })()}
          </div>
        </Modal>
      )}
    </div>
  );
}

function Modal({ children, onClose, headerTitle, headerSubtitle }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/50 p-4 z-80">
      <div className="bg-white rounded max-w-full sm:max-w-3xl md:max-w-2xl lg:max-w-4xl w-full h-[90vh] m-2 flex flex-col overflow-hidden">
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-white border-b p-4">
          <div className="text-lg font-semibold">{headerTitle}</div>
          {headerSubtitle ? (
            <div className="text-sm text-gray-600 mt-1">{headerSubtitle}</div>
          ) : null}
        </div>

        {/* Scrollable body */}
        <div className="p-4 overflow-y-auto flex-1">{children}</div>

        {/* Footer with persistent close button */}
        <div className="p-4 text-right border-t bg-white">
          <button onClick={onClose} className="px-3 py-1 bg-gray-200 rounded">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// Realtime profile card that listens to Firestore for admin user updates.
function ProfileCard({ adminId }) {
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(null);

  useEffect(() => {
    let unsub = null;
    let authUnsub = null;
    setLoading(true);
    setErr(null);

    try {
      authUnsub = onAuthStateChanged(auth, (user) => {
        // If there's an authenticated user, show the auth-provided name/email immediately
        if (user) {
          setProfile({
            id: user.uid,
            name: user.displayName || null,
            email: user.email || null,
            photoURL: user.photoURL || null,
          });
          setLoading(false);

          // also subscribe to their Firestore users/{uid} doc and use it to enrich/replace profile when available
          if (typeof unsub === "function") unsub();
          const d = doc(db, "users", user.uid);
          unsub = onSnapshot(
            d,
            (snap) => {
              if (!snap.exists()) {
                // keep auth-derived profile if no Firestore document
                return;
              }
              setProfile({ id: snap.id, ...snap.data() });
            },
            (e) => {
              console.error("ProfileCard snapshot error:", e);
              setErr(e.message || String(e));
            }
          );
          return;
        }

        // Not signed in: use provided adminId if available
        if (adminId) {
          if (typeof unsub === "function") unsub();
          const d = doc(db, "users", adminId);
          unsub = onSnapshot(
            d,
            (snap) => {
              if (!snap.exists()) {
                setProfile(null);
                setLoading(false);
                return;
              }
              setProfile({ id: snap.id, ...snap.data() });
              setLoading(false);
            },
            (e) => {
              console.error("ProfileCard snapshot error:", e);
              setErr(e.message || String(e));
              setLoading(false);
            }
          );
          return;
        }

        // Final fallback: find first user with role 'admin'
        if (typeof unsub === "function") unsub();
        const q = fsQuery(
          collection(db, "users"),
          where("role", "==", "admin")
        );
        unsub = onSnapshot(
          q,
          (snap) => {
            const first = snap.docs[0];
            if (!first) {
              setProfile(null);
              setLoading(false);
              return;
            }
            setProfile({ id: first.id, ...first.data() });
            setLoading(false);
          },
          (e) => {
            console.error("ProfileCard query snapshot error:", e);
            setErr(e.message || String(e));
            setLoading(false);
          }
        );
      });
    } catch (e) {
      setErr(String(e));
      setLoading(false);
    }

    return () => {
      if (typeof unsub === "function") unsub();
      if (typeof authUnsub === "function") authUnsub();
    };
  }, [adminId]);

  if (loading)
    return (
      <div className="flex items-center gap-1">
        <div className="w-12 h-12 rounded-full bg-gray-100 animate-pulse" />
        <div className="text-sm">
          <div className="w-28 h-3 bg-gray-100 rounded mb-1 animate-pulse" />
          <div className="w-32 h-2 bg-gray-100 rounded animate-pulse" />
        </div>
      </div>
    );

  if (err)
    return <div className="text-sm text-red-600">Error loading profile</div>;

  if (!profile)
    return <div className="text-sm text-gray-600">No admin profile found</div>;

  return (
    <div className="flex items-center gap-2">
      <div className="text-right">
        <div className="text-xs text-gray-500">Signed in as</div>
        <div className="font-medium">{profile.name || "Admin User"}</div>
        <div className="text-xs text-gray-400">
          {profile.email || "admin@example.com"}
        </div>
      </div>
      <div className="w-12 h-12 rounded-full overflow-hidden border border-gray-200">
        {/* If profile has a photo URL use it, otherwise fall back to admin.png */}
        <div
          className="w-full h-full bg-center bg-cover"
          style={{
            backgroundImage: `url('${profile.photoURL || "/admin.png"}')`,
          }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}
