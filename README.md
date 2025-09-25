MindSphere Prototype

This workspace contains a React + Vite prototype frontend under `client/` implementing a stigma-free mental health student support prototype. It includes:

- Anonymous chatbot (prototype)
-- Screening demo (PHQ style) with score POST to backend
-- Confidential booking prototype (POST to backend)
-- Anonymous peer forum (backend)
- Resource library and Admin dashboard (anonymized metrics)

Run locally (full stack):

1. Backend (Flask)

	- Create and activate a Python virtual environment (Windows PowerShell):

	  ```powershell
	  cd server
	  python -m venv .venv
	  .\.venv\Scripts\Activate.ps1
	  pip install -r requirements.txt
	  python index.py
	  ```

	- Backend will run on http://localhost:5000

2. Frontend (React + Vite)

	```powershell
	cd client
	npm install
	npm run dev
	```

	- The frontend expects the backend at http://localhost:5000 by default. You can override with an env var `VITE_API_BASE`.

Note: This prototype uses in-memory storage in the backend. Replace with a database and add encryption and real authentication for production.

Deploy to Vercel:

1. Push this repo to GitHub
2. Import the repo in Vercel and set framework to Vite (React)
3. Vercel will deploy the frontend and serverless functions automatically from `client/api`.

Security notes: this is a prototype. Do not store PII. Implement end-to-end encryption and safety routing for high-risk cases before production.
# MindSphere
Development of a Digital Mental Health and Psychological Support System for Students in Higher Education
