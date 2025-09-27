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
forum_posts = []
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
	user_message = data.get('message') or data.get('text')
	if not user_message:
		return jsonify({"error": "Message is required"}), 400
	if helpers.detect_crisis(user_message):
		return jsonify({"response": "It sounds like you may be in crisis. Please contact local emergency services or a crisis hotline right away.", "escalate": True})
	if not helpers.looks_student_mh_related(user_message):
		# Ask a brief clarifying question instead of flat rejection
		clarifying = (
			"I want to help, but I specialize in student mental health topics (stress, anxiety, sleep, motivation, relationships). "
			"Could you tell me a bit more about what's going on or whether this is about how you're feeling?"
		)
		return jsonify({"response": clarifying})
	prompt = helpers.build_coping_prompt(user_message)
	try:
		text = modelutils.generate_coping_text(prompt)
	except Exception as e:
		# Surface the model error to the client (5xx). Caller requested strict model-only behavior.
		return jsonify({"error": "Model generation failed", "details": str(e)}), 500
	return jsonify({"response": text, "escalate": False})


@bp.route('/api/phq9', methods=['POST', 'OPTIONS'])
def phq9_post():
	if request.method == 'OPTIONS':
		return '', 204
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


@bp.route('/api/forum', methods=['GET', 'POST'])
def api_forum():
	if request.method == 'POST':
		data = request.get_json() or {}
		text = data.get('text')
		if not text:
			return jsonify({"error": "text required"}), 400
		post = {"id": int(datetime.utcnow().timestamp() * 1000), "text": text, "anon": True}
		forum_posts.insert(0, post)
		return jsonify(post), 201
	return jsonify({"posts": forum_posts})


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


@bp.route('/api/admin', methods=['GET'])
def api_admin():
	metrics = {"activeUsers": 124, "screenings": len(screenings), "bookings": len(bookings), "forumPosts": len(forum_posts)}
	return jsonify(metrics)


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



# Register the blueprint now that all routes are ready
app.register_blueprint(bp)


if __name__ == '__main__':
	dbutils.init_mongo()
	modelutils.init_model()
	app.run(port=int(os.getenv('PORT')), debug=True)
