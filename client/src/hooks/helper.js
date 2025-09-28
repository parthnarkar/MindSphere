// Prefer explicit Vite env var, fall back to relative-path (same origin) so
// frontend fetches work during local/dev runs without extra configuration.
let API = import.meta.env.VITE_API_BASE || '';

// In production, prefer a deployed base if provided
if (import.meta.env.MODE === "production") {
  API = import.meta.env.VITE_DEPLOYED_BASE || API || '';
}

// Normalize to empty string rather than undefined so `${API}/api/...` works as expected
if (!API) API = '';

export { API };
