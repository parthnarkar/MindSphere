# MindSphere

MindSphere is a prototype digital mental-health support system built for student-facing workflows. This README has been re-written to match the actual repository contents (frontend + Flask backend). 

WARNING: this project is a research/prototype sample. It is NOT production-ready. Do not store or process real PII here. Use strong security controls and official clinical workflows before any real deployment.

Contents
- Overview
- Architecture
- Quickstart (Windows / PowerShell)
- Environment variables
- Development (frontend & backend)
- Key API endpoints
- Email & testing tips
- Deployment (Vercel) notes
- Troubleshooting
- Contributing

## Overview

This repository contains two main parts:

- `client/` — React + Vite frontend
- `server/` — Flask REST API (single-file entry `server/app.py` with routes mounted on a blueprint)

The frontend provides the UI (chatbot, screening modal, booking, profile and dashboards). The backend exposes REST endpoints for chat, PHQ-9 submissions, sessions, resources, posts, and admin metrics. The backend includes optional MongoDB support and optional integration with Google Generative AI (Gemini) when configured.

## Architecture

- Frontend: React + Vite, React Router, Firebase Auth + Firestore for user identity/role metadata.
- Backend: Flask app implemented in `server/app.py`; helper utilities in `server/utils/` (db, helpers, model).
- Persistence: optional MongoDB (configured via `MONGO_URI`). When Mongo isn't configured the server falls back to in-memory stores for many features (useful for local dev).
- Email: SMTP via standard library `smtplib`. Emergency notification endpoint builds multipart plain+HTML emails using `server/utils/helpers.py` and sends via SMTP configured by environment variables.

## Quickstart (Windows / PowerShell)

Prerequisites
- Node 18+ and npm
- Python 3.10+ and pip
- Recommended: a local SMTP capture server for email testing (MailHog or smtp4dev)

Clone the repo and run frontend and backend locally:

1) Frontend

```powershell
cd D:\MindSphere\client
npm install
npm run dev
# App available at http://localhost:5173
```

2) Backend (Flask)

```powershell
cd D:\MindSphere\server
python -m venv .venv
. .venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
# The server listens on the Flask default (5000) by default; visit http://localhost:5000/
```

Note: `server/api/index.py` is present but it simply imports the Flask `app` (the primary code lives in `server/app.py`). Use `app.py` for local dev; the `api/index.py` shim can be useful when mapping serverless handlers in some hosting setups.

## Environment variables

Copy `server/.env.example` (if present) to `server/.env` and fill values. Important server variables:

- `VITE_API_BASE` (client env) — the base URL for API requests (e.g. `http://localhost:5000`)
- `MONGO_URI` — (optional) MongoDB connection string
- `GEMINI_API_KEY` — (optional) Google Generative AI (Gemini) API key used by `server/utils/model.py`
- `SMTP_HOST` — SMTP host for outgoing email alerts (use MailHog/smtp4dev for local testing)
- `SMTP_PORT` — SMTP port (MailHog default: 1025)
- `SMTP_USER` / `SMTP_PASS` — credentials (optional)
- `EMAIL_FROM` — From address for outgoing alert emails
- `EMAIL_TO` — Comma-separated list of recipients for emergency emails
- `ADMIN_SUMMARY_TOKEN` — (optional) token to protect some admin summary endpoints

Security: never commit `.env` files or credentials to source control. Store secrets in your hosting platform's secure environment config.

## Development notes

- The frontend uses Firebase Auth. A Firestore `users/{uid}` document is expected for role metadata. The app contains logic to create a minimal `users` doc on first sign-in (best-effort) to avoid redirect loops.
- The backend safely falls back to in-memory stores when MongoDB isn't provided so you can run everything locally without external services.
- The backend exposes many helpful endpoints for development and testing (see below).

## Key API endpoints (selected)

These are available under the Flask app root (default `http://localhost:5000`):

- GET  /                     — health check (returns { status: 'ok' })
- POST /api/chat             — chatbot message (body: { message: string, session_id?, history? })
- GET/POST /api/chat/session — create/list chat sessions
- GET/POST /api/chat/session/<id>/messages — read/append session messages
- POST /api/notify/emergency_mail — build and send an emergency notification email (expects JSON describing detection context)
- GET/POST /api/phq9         — submit or list PHQ-9 screening results
- GET /api/phq9/<email>      — get latest PHQ-9 for an email
- GET/POST /api/posts        — forum posts (in-memory or Mongo-backed)
- GET/POST /api/resources    — resource CRUD
- GET /api/admin             — basic admin metrics

Read the handler docstrings and `server/app.py` for full request/response details and optional query params.

## Email & testing tips

- For local email testing, run MailHog or smtp4dev and point `SMTP_HOST`/`SMTP_PORT` at it. Example MailHog default: host `localhost`, port `1025`.
- The emergency mail route constructs a multipart EmailMessage with plain-text and HTML alternatives when available. If SMTP is not configured the route returns a helpful error.

## Deployment notes (Vercel and general guidance)

- This repository is structured to allow deploying the frontend (client/) as a Vite site. The Flask backend can be deployed as serverless Python endpoints (Vercel supports Python serverless functions) or as a traditional server (container/VM).
- If you deploy the Flask app as serverless functions, ensure environment variables (Mongo, SMTP, GEMINI_API_KEY) are set in the provider. Avoid expensive synchronous model initialization at cold start.
- `requirements.txt` contains the necessary Python runtime packages (Flask, flask-cors, python-dotenv, google-generativeai, pymongo, dnspython, requests).

## Troubleshooting

- Health check returns 500 or import errors: activate the Python virtualenv and run `pip install -r requirements.txt`.
- Chatbot returns `model not configured` or 503: set `GEMINI_API_KEY` and review `server/utils/model.py`.
- Emails not delivered: verify SMTP settings and run a local SMTP catcher (MailHog). Check server logs for SMTP exceptions.
- Frontend stuck on landing after sign-in: Firestore `users/{uid}` doc may not be present yet; the client performs a best-effort creation but latency can cause redirects. Ensure your Firebase setup mirrors the `client/.env.example` configuration.

## Files of interest

- `client/` — React app. Key files: `src/App.jsx`, `src/services/auth.js`, `src/components/Header.jsx`.
- `server/app.py` — main Flask application and all REST routes.
- `server/utils/` — `helpers.py`, `db.py`, `model.py` contain helper utilities (email builder, DB helpers, model init).
- `server/requirements.txt` — Python runtime dependencies.

## Contributing

PRs and issues are welcome. For small changes:

1. Fork & branch
2. Run the app locally (frontend + backend)
3. Include tests where meaningful and document env changes

If you'd like, I can add a small CI workflow that runs linting and a simple Flask import check on push. Tell me if you want that and whether you prefer GitHub Actions or another CI provider.

---

If you'd like, I can now:

- add a minimal `server/README.md` with exact env keys and simple run commands
- create a GitHub Actions workflow that runs `python -c "import server.app"` and `npm ci && npm run build` on pushes
- add a short `CONTRIBUTING.md`

Tell me which follow-up you'd like and I'll implement it.
