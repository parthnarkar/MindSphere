# MindSphere — Client (React + Vite)

This README expands the default Vite template with MindSphere-specific developer and deployment guidance. It focuses on environment configuration, local development, building, CI, and secure deployment.

Table of contents
- Quick start
- Environment variables
- Local development
- Build & preview
- Testing & linting
- Deployment (Vercel)
- Project structure
- Security and privacy
- Troubleshooting
- CI suggestions

## Quick start

1. Copy example env and install dependencies:

```powershell
cd client
copy .env.example .env
npm install
```

2. Start dev server with hot reload:

```powershell
npm run dev
```

Visit http://localhost:5173 (or the URL printed by Vite).

## Environment variables

The client uses Vite env vars (only variables prefixed with `VITE_` are exposed to client code). Keep sensitive secrets on the server-side.

Key variables (placeholders are in `client/.env.example`):

- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`, `VITE_FIREBASE_APP_ID` — Firebase configuration for client auth and storage.
- `VITE_YT_API_KEY`, `VITE_YT_PLAYLIST_ID` — Optional YouTube API access used by the resources page.
- `VITE_API_BASE` — Local backend URL (default: `http://localhost:5000`).
- `VITE_DEPLOYED_BACKEND_URL` — Production backend base URL used when the app is deployed.
- `VITE_ADMIN_SUMMARY_TOKEN` — Short admin token used by admin UI flows. DO NOT store true secrets in client-side env for production.

Where to set them
- For local development: `client/.env` (copy from `.env.example`).
- For Vercel or other hosts: set environment variables in the project settings UI.

## Local development

- Start the dev server:

```powershell
npm run dev
```

- Linting (ESLint):

```powershell
npm run lint
```

- Format (if using Prettier, adjust accordingly):

```powershell
npm run format
```

If you change environment variables, restart the dev server so Vite picks them up.

## Build & preview

- Build production bundle:

```powershell
npm run build
```

- Preview production build locally:

```powershell
npm run preview
```

When deploying, ensure `VITE_DEPLOYED_BACKEND_URL` points to your deployed backend.

## Testing & linting

- The client currently does not include a formal test suite. Consider adding Jest/React Testing Library for unit/component tests and Playwright for end-to-end tests.
- Linting is configured via ESLint rules in `eslint.config.js`.

## Deployment (Vercel)

This project contains `client/vercel.json` and is Vercel-ready. Deployment checklist:

1. In Vercel Project Settings, add the `VITE_` environment variables used by the client.
2. Ensure your backend is deployed and reachable from the frontend (set `VITE_DEPLOYED_BACKEND_URL`).
3. For client-only apps, Vercel will build the static site automatically. For serverless endpoints, ensure your server is deployed separately (the repo contains a `server/` folder configured for Vercel Functions).

Security note: Vite `VITE_` variables are embedded at build time. Never put secrets that must remain private in these variables for production builds.

## Project structure

Top-level client folders you will work with:

- `src/pages/` — Pages (Chatbot, Peer-to-Peer, Booking, Profile, etc.)
- `src/components/` — Reusable UI components
- `src/services/` — Auth and backend service wrappers (Firebase, API calls)
- `src/hooks/` — Custom React hooks

Quick pointers:
- `src/services/firebase.js` configures Firebase and is initialized from `VITE_FIREBASE_*` env vars.
- `src/pages/Peer-to-Peer.jsx` is the forum page that calls the backend `/api/posts` endpoints.

## Security & privacy

- Do not store sensitive API keys in the client. For server-side-only secrets, put them in the `server/.env` or in your host's secret store and expose only necessary functionality via authenticated endpoints.
- If you add analytics or third-party SDKs, update the privacy policy and obtain user consent where required.

## Troubleshooting

- Dev server doesn't pick up env changes: stop and restart the dev server.
- API calls failing with CORS: ensure backend allows requests from your dev origin (check server CORS settings).
- Missing assets after build: confirm assets are referenced from `public/` or imported correctly in code.

## CI / Automation suggestions

- Add a GitHub Actions workflow to run `npm ci`, lint the code, and build the app on push to main.
- Optionally, add an integration step that runs the server `ultimate_server_test.py` after the backend is deployed to verify compatibility.

## Helpful tools & next steps I can implement

- Add `client/scripts/validate-env.js` to check for required `VITE_` variables during `npm run dev`.
- Add automated unit tests (Jest + RTL) for key components.
- Add a simple Playwright e2e test for the Peer-to-Peer flow.

If you'd like any of these implemented, tell me which and I'll add them.
