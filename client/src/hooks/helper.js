let local_Link = "http://localhost:5000";

if (environment === "production") {
  local_Link = import.meta.env.VITE_API_BASE;
}

export const API = local_Link;