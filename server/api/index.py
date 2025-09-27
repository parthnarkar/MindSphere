from flask import Flask, request, jsonify, Blueprint
from flask_cors import CORS
from dotenv import load_dotenv
import os
import sys
from datetime import datetime

# Load env
load_dotenv()

from utils import db as dbutils
from utils import model as modelutils
from utils import helpers as helpers


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)
app.config.update({'JSON_SORT_KEYS': False})

# Define a local blueprint to keep routes organized inside this master file
bp = Blueprint('api', __name__)

# In-memory fallbacks
bookings = []
screenings = []
resources = [{"id": 1, "title": "Intro to coping skills", "type": "video", "language": "English", "url": ""}]


def startup():
	# Initialize optional backends (safe no-ops if not configured)
	try:
		dbutils.init_mongo()
	except Exception:
		pass
	try:
		modelutils.init_model()
	except Exception:
		pass

# Call startup at import time to ensure utils are initialized for direct script use
startup()


@bp.route('/')
def health():
	return jsonify({"status": "ok", "service": "mindsphere-server"})


# NOTE: register blueprint after all route handlers are defined (done below)


@bp.route('/api/chat', methods=['POST', 'OPTIONS'])
def api_chat():
	if request.method == 'OPTIONS':
		return '', 204
	data = request.get_json() or {}
	# Ignore any client-side intent hints; detect on server for a single source of truth
	user_message = data.get('message') or data.get('text')
	if not user_message:
		return jsonify({"error": "Message is required"}), 400
	# Run server-side intent detection first
	detected = helpers.detect_intent(user_message)

	# Crisis handling: ask the model to generate the crisis-aware reply so no hardcoded text is returned
	if detected.get('intent') == 'crisis' or helpers.detect_crisis(user_message):
		prompt = (
			"You are a compassionate, safety-focused support assistant. The user message appears to indicate a crisis. "
			"Provide a short, empathetic response that urges the user to seek immediate help and lists crisis resources. "
			"Do NOT provide medical advice beyond recommending contacting emergency services or a crisis hotline."
			f"\nUser message: {user_message}"
		)
		try:
			text = modelutils.generate_coping_text(prompt)
		except Exception as e:
			return jsonify({"error": "Model generation failed", "details": str(e)}), 500
		return jsonify({"response": text, "escalate": True, "intent": "crisis", "intentConfidence": detected.get('confidence', 1.0)})

	# Topic gate: if message isn't clearly student MH-related, ask the model to craft a clarifying question
	if not helpers.looks_student_mh_related(user_message):
		prompt = (
			"You are a supportive assistant. The user message may be outside the scope of student mental health. "
			"Please generate one brief clarifying question that asks whether the user is discussing how they are feeling or a different topic. "
			f"\nUser message: {user_message}"
		)
		try:
			text = modelutils.generate_coping_text(prompt)
		except Exception as e:
			return jsonify({"error": "Model generation failed", "details": str(e)}), 500
		return jsonify({"response": text, "escalate": False, "intent": detected.get('intent'), "intentConfidence": detected.get('confidence')})

	# Normal flow: include detected intent in prompt, ask model for coping/strategies
	prompt = helpers.build_coping_prompt(f"[intent={detected.get('intent')}] {user_message}")
	try:
		text = modelutils.generate_coping_text(prompt)
	except Exception as e:
		# Surface the model error to the client (5xx). Caller requested strict model-only behavior.
		return jsonify({"error": "Model generation failed", "details": str(e)}), 500
	return jsonify({"response": text, "escalate": False, "intent": detected.get('intent'), "intentConfidence": detected.get('confidence')})



@bp.route('/api/chat/init', methods=['GET'])
def api_chat_init():
	"""Return a model-generated opening message for the chatbot (no hardcoded content)."""
	# Construct a prompt instructing the model to produce a concise friendly greeting
	prompt = (
		"You are an anonymous, stigma-free support assistant talking to a student. "
		"Provide a short, welcoming opening message (one or two sentences) that invites the user to share how they're feeling. "
		"Avoid medical claims and do not reference internal system names."
	)
	try:
		text = modelutils.generate_coping_text(prompt)
	except Exception as e:
		return jsonify({"error": "Model generation failed", "details": str(e)}), 500
	return jsonify({"response": text})


@bp.route('/api/phq9', methods=['GET', 'POST', 'OPTIONS'])
def phq9_post():
	# Support GET for listing all PHQ-9 submissions and POST for adding a new one.
	if request.method == 'OPTIONS':
		return '', 204

	if request.method == 'GET':
		# Return all PHQ-9 documents (db-backed if available, otherwise in-memory)
		coll = dbutils.get_phq9_collection()
		docs = []
		if coll is not None:
			docs = list(coll.find().sort([('timestamp', -1)]).limit(2000))
			out = []
			for d in docs:
				dd = dict(d)
				if '_id' in dd:
					try:
						dd['id'] = str(dd.pop('_id'))
					except Exception:
						dd.pop('_id', None)
				try:
					if 'timestamp' in dd and hasattr(dd['timestamp'], 'isoformat'):
						dd['timestamp'] = dd['timestamp'].isoformat()
				except Exception:
					pass
				out.append(dd)
			return jsonify({'phq9_responses': out})

		# No DB configured -> return in-memory responses if present
		out = []
		if hasattr(dbutils, 'phq9_in_memory'):
			for d in dbutils.phq9_in_memory:
				dd = d.copy()
				try:
					if 'timestamp' in dd and hasattr(dd['timestamp'], 'isoformat'):
						dd['timestamp'] = dd['timestamp'].isoformat()
				except Exception:
					pass
				out.append(dd)
		return jsonify({'phq9_responses': out})

	# POST path (create new submission)
	data = request.get_json() or {}
	user_email = data.get('user_email')
	answers = data.get('answers')
	if not user_email or not isinstance(answers, list) or len(answers) != 9:
		return jsonify({"error": "user_email and answers[9] are required"}), 400
	try:
		answers_int = [int(x) for x in answers]
	except Exception:
		return jsonify({"error": "answers must be integers"}), 400
	total_score = sum(answers_int)
	now = datetime.utcnow()
	doc = {"user_email": user_email.lower(), "timestamp": now, "answers": answers_int, "total_score": total_score}
	if dbutils.insert_phq9(doc):
		return jsonify({"ok": True}), 201
	if not hasattr(dbutils, 'phq9_in_memory'):
		dbutils.phq9_in_memory = []
	dbutils.phq9_in_memory.insert(0, doc)
	return jsonify(doc), 201


@bp.route('/api/phq9/<email>', methods=['GET', 'OPTIONS'])
def phq9_get_latest(email):
	if request.method == 'OPTIONS':
		return '', 204
	doc = dbutils.find_latest_phq9(email)
	if doc:
		# copy and convert non-JSON types (ObjectId, datetime)
		safe = dict(doc)
		if '_id' in safe:
			try:
				safe['id'] = str(safe.pop('_id'))
			except Exception:
				safe.pop('_id', None)
		try:
			if 'timestamp' in safe and hasattr(safe['timestamp'], 'isoformat'):
				safe['timestamp'] = safe['timestamp'].isoformat()
		except Exception:
			pass
		return jsonify(safe)
	if hasattr(dbutils, 'phq9_in_memory'):
		for d in dbutils.phq9_in_memory:
			if d.get('user_email') == email.lower():
				d2 = d.copy()
				try:
					if 'timestamp' in d2 and hasattr(d2['timestamp'], 'isoformat'):
						d2['timestamp'] = d2['timestamp'].isoformat()
				except Exception:
					pass
				return jsonify(d2)
	return jsonify({}), 200


@bp.route('/api/bookings', methods=['GET', 'POST'])
def api_bookings():
	if request.method == 'POST':
		data = request.get_json() or {}
		entry = {"id": int(datetime.utcnow().timestamp() * 1000), "name": data.get('name', 'anonymous'), "time": data.get('time')}
		bookings.insert(0, entry)
		return jsonify({"ok": True, "id": entry['id']}), 201
	return jsonify({"bookings": bookings})


@bp.route('/api/resources', methods=['GET', 'POST'])
def api_resources():
	if request.method == 'POST':
		data = request.get_json() or {}
		title = data.get('title')
		if not title:
			return jsonify({"error": "title required"}), 400
		item = {"id": int(datetime.utcnow().timestamp() * 1000), "title": title, "type": data.get('type', 'guide'), "language": data.get('language', 'English'), "url": data.get('url', '')}
		resources.insert(0, item)
		return jsonify(item), 201
	return jsonify({"resources": resources})



@bp.route('/api/screenings', methods=['GET', 'POST'])
def api_screenings():
	if request.method == 'POST':
		data = request.get_json() or {}
		score = data.get('score')
		if score is None:
			return jsonify({"error": "score required"}), 400
		entry = {"id": int(datetime.utcnow().timestamp() * 1000), "score": score}
		screenings.insert(0, entry)
		return jsonify({"ok": True}), 201
	return jsonify({"screenings": screenings})



@bp.route('/api/clients', methods=['GET'])
def api_clients():
	try:
		if getattr(dbutils, 'mongo_db', None) is not None:
			coll = dbutils.mongo_db.get_collection('clients')
			docs = list(coll.find().sort([('createdAt', -1)]).limit(200))
			for d in docs:
				d['id'] = str(d.get('_id'))
				if '_id' in d:
					del d['_id']
				if 'createdAt' in d:
					try:
						d['createdAt'] = d['createdAt'].isoformat()
					except Exception:
						d['createdAt'] = str(d['createdAt'])
			return jsonify({'clients': docs})
		sample = [{ 'id': 'sample-1', 'name': 'Student A', 'email': 'a@example.edu', 'submittedAt': '2025-01-01T10:00:00' }]
		return jsonify({'clients': sample})
	except Exception as e:
		return jsonify({'error': str(e)}), 500



@bp.route('/api/clients-with-phq', methods=['GET'])
def api_clients_with_phq():
	"""Return clients with their latest PHQ-9 attached as `latest_phq` when available.

	Behavior:
	- If MongoDB configured: read clients from `clients` collection and query `phq9_responses`
	  for the most recent PHQ per client (matching by lowercased email).
	- If no clients collection is present, fall back to returning PHQ-only entries as client-like
	  records (so the front-end always receives useful data).
	"""
	try:
		phq_coll = dbutils.get_phq9_collection()
		out = []
		if getattr(dbutils, 'mongo_db', None) is not None:
			coll = dbutils.mongo_db.get_collection('clients')
			docs = list(coll.find().sort([('createdAt', -1)]).limit(200))
			for d in docs:
				cd = dict(d)
				# normalize id/createdAt
				if '_id' in cd:
					try:
						cd['id'] = str(cd.get('_id'))
						del cd['_id']
					except Exception:
						cd.pop('_id', None)
				if 'createdAt' in cd:
					try:
						cd['createdAt'] = cd['createdAt'].isoformat()
					except Exception:
						cd['createdAt'] = str(cd['createdAt'])

				email = (cd.get('email') or cd.get('emailAddress') or '').lower()
				latest = None
				if phq_coll is not None and email:
					try:
						latest = phq_coll.find_one({'user_email': email}, sort=[('timestamp', -1)])
					except Exception:
						latest = None
				if latest:
					lp = dict(latest)
					if '_id' in lp:
						try:
							lp['id'] = str(lp.pop('_id'))
						except Exception:
							lp.pop('_id', None)
					try:
						if 'timestamp' in lp and hasattr(lp['timestamp'], 'isoformat'):
							lp['timestamp'] = lp['timestamp'].isoformat()
					except Exception:
						pass
					cd['latest_phq'] = lp
				out.append(cd)
			return jsonify({'clients': out})

		# No DB: try to synthesize clients from PHQ in-memory
		if hasattr(dbutils, 'phq9_in_memory') and dbutils.phq9_in_memory:
			# group by email and pick latest
			grouped = {}
			for p in dbutils.phq9_in_memory:
				email = (p.get('user_email') or '').lower()
				if not email:
					continue
				if email not in grouped or p.get('timestamp') > grouped[email].get('timestamp'):
					grouped[email] = p
			for email, p in grouped.items():
				rec = {'id': f'phq-{email}', 'name': None, 'email': email, 'latest_phq': p}
				# convert timestamp to iso if present
				try:
					if 'timestamp' in rec['latest_phq'] and hasattr(rec['latest_phq']['timestamp'], 'isoformat'):
						rec['latest_phq']['timestamp'] = rec['latest_phq']['timestamp'].isoformat()
				except Exception:
					pass
				out.append(rec)
			return jsonify({'clients': out})

		# Nothing to return
		return jsonify({'clients': []})
	except Exception as e:
		return jsonify({'error': str(e)}), 500



# Register the blueprint now that all routes are ready
app.register_blueprint(bp)


if __name__ == '__main__':
	dbutils.init_mongo()
	modelutils.init_model()
	# Default to 5000 if PORT not set; bind to all interfaces for local testing
	port = int(os.getenv('PORT') or 5000)
	print(f"Starting REST API")
	app.run(port=port, debug=True)
