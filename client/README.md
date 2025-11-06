# MindSphere — Client (React + Vite)

This README provides a focused, developer-friendly guide for the client (React + Vite) portion of MindSphere. It covers setup, environment variables, common commands, project layout, and deployment notes.

Table of contents
- Quick start
- Environment variables
- Development commands
- Build & preview
- Linting & formatting
- Deployment (Vercel)
- Project structure
- Security & privacy
- Troubleshooting
- Suggested next steps

---

## Quick start

1. Copy example env and install dependencies:

```powershell
cd client
copy .env.example .env
npm install
```

2. Start the dev server with hot reload:

```powershell
npm run dev
```

Open the URL printed by Vite (typically http://localhost:5173).

## Environment variables

The client uses Vite environment variables. Only variables prefixed with `VITE_` are embedded into the client bundle at build time. Do NOT store secrets you want to keep private here.

Common variables (see `client/.env.example`):

- VITE_API_BASE — Backend base for local development (e.g. http://localhost:5000)
- VITE_DEPLOYED_BACKEND_URL — Production backend base URL
- VITE_YT_API_KEY, VITE_YT_PLAYLIST_ID — (Optional) YouTube API keys used by the Resources page
- VITE_FIREBASE_* — Firebase configuration (if using Firebase auth/storage)
- VITE_ADMIN_SUMMARY_TOKEN — Short admin token used by admin UI flows (not a secret for production)

Where to set them:
- Local development: create `client/.env` (copy `.env.example`)
- Vercel / CI: set environment variables in project settings

If you modify env vars, restart the Vite dev server so the changes take effect.

## Development commands

- Start dev server: `npm run dev`
- Build production bundle: `npm run build`
- Preview production build: `npm run preview`
- Lint: `npm run lint`
- (Optional) Format: `npm run format` (if configured)

All commands are intended to be run from the `client/` directory.

## Build & preview

Build the app for production:

```powershell
npm run build
```

Preview the production build locally:

```powershell
npm run preview
```

Before deploying make sure `VITE_DEPLOYED_BACKEND_URL` points to the correct backend.

## Linting & formatting

- ESLint is configured via `eslint.config.js`. Run `npm run lint` to check code.
- If you add Prettier or other formatters, add a `format` script and optionally a pre-commit hook.

## Deployment (Vercel)

This project includes `client/vercel.json` and is ready to deploy on Vercel. Checklist:

1. Add the required `VITE_` env variables in Vercel project settings.
2. Ensure the backend API is deployed and `VITE_DEPLOYED_BACKEND_URL` points to it.
3. Vercel will build the site during deployment; sensitive server-only keys must remain on the server side.

If you deploy the server as Vercel serverless functions, confirm CORS and routing between frontend and API.

## Project structure

Key folders/files you'll work with:

- `src/pages/` — Page components (Chatbot, Peer-to-Peer, Resources, AdminDashboard, etc.)
- `src/components/` — Reusable UI components
- `src/services/` — Auth and backend wrappers (Firebase, API helpers)
- `src/hooks/` — Reusable hooks
- `public/` — Static assets

Notable files:
- `src/pages/Resources.jsx` — Resource search page (YouTube, Wikipedia, OpenLibrary integrations)
- `src/pages/Chatbot.jsx` — Chat UI; calls `/api/chat`
- `src/services/firebase.js` — Firebase initialization when used

## Security & privacy

- Never store server-only secrets in `VITE_` env vars for production; use server environment variables or a secrets manager.
- Limit client-side telemetry and disclose any analytics in your privacy policy.
- For emergency or sensitive flows (e.g., sending emails), ensure credentials live on the server and are not exposed to client code.

## Troubleshooting

- Dev server not picking up env changes: stop and restart `npm run dev`.
- CORS errors: verify backend `Access-Control-Allow-Origin` is set for dev host or use `VITE_API_BASE`/proxy configuration.
- Missing or broken assets after build: ensure files are in `public/` or imported from `src/`.
- YouTube/Wikipedia/OpenLibrary API failures: confirm `VITE_YT_API_KEY` and backend endpoints are configured and reachable.

## Suggested next steps (optional tasks I can help implement)

- Add `client/scripts/validate-env.js` to confirm required `VITE_` variables before dev/start.
- Add Jest + React Testing Library for unit tests and a basic Playwright e2e test for the main flows.
- Add CI GitHub Actions workflow: install, lint, build, and optionally run a small integration test against the server.
- Add developer documentation pages for design tokens and Tailwind usage.
