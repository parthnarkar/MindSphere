// Prefer explicit Vite env var, fall back to relative-path (same origin) so
// frontend fetches work during local/dev runs without extra configuration.
let API;

// In production, prefer a deployed base if provided
if (import.meta.env.MODE === "development") {
  API = import.meta.env.VITE_API_BASE;
}
else {
  API = import.meta.env.VITE_DEPLOYED_BACKEND_URL; 
}

export { API };
