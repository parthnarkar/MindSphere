import { API } from "./helper";

const base = API

export async function getLatestPhq9(email) {
  const url = `${base}/api/phq9/${encodeURIComponent(email)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  return data?.result || null;
}

export async function submitPhq9(email, answers) {
  const url = `${base}/api/phq9`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_email: email, answers })
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Failed to submit PHQ-9 (${res.status})`);
  }
  return res.json();
}



