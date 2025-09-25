let API = import.meta.env.VITE_API_BASE;

// Auto detect environment without needing explicit env var
if (import.meta.env.MODE === "production") {
  API = import.meta.env.VITE_DEPLOYED_BASE;
}

export { API };
