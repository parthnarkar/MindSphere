from flask import Flask, request, jsonify
from flask_cors import CORS
import time
import google.generativeai as genai
import os
from dotenv import load_dotenv
from difflib import SequenceMatcher
<<<<<<< HEAD
from datetime import datetime, timedelta
=======
>>>>>>> bcf35da (Add client fetching functionality to Counsellor Dashboard and implement MongoDB connection in API)
from pymongo import MongoClient

# Load API key
load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = Flask(__name__)
# Enable CORS for local dev (Vite on 5173/5174 -> Flask on 5000)
CORS(app, resources={r"/*": {"origins": "*"}}, supports_credentials=False)

# MongoDB client
# Use safe defaults if env vars are missing
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
MONGO_DB = os.getenv("MONGO_DB", "mindsphere")
mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=3000)
mongo_db = mongo_client[MONGO_DB]
phq9_collection = mongo_db["phq9_responses"]

# Ensure helpful indexes (no-op if they already exist)
try:
    phq9_collection.create_index([("user_email", 1), ("timestamp", -1)], name="user_ts_desc")
except Exception:
    pass

# In-memory prototype storage (replace with DB in production)
bookings = []
forum_posts = []
screenings = []
resources = [
	{"id": 1, "title": "Intro to coping skills", "type": "video", "language": "English", "url": ""},
	{"id": 2, "title": "How to support a friend", "type": "video", "language": "Hindi", "url": ""},
	{"id": 3, "title": "Offline resource map", "type": "guide", "language": "Regional", "url": ""},
]

# Optional MongoDB connection: if MONGO_URI is set in environment, use it.
load_dotenv()
MONGO_URI = os.getenv("MONGO_URI")
mongo_client = None
mongo_db = None
if MONGO_URI:
	try:
		mongo_client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=2000)
		mongo_db = mongo_client.get_default_database()
	except Exception as e:
		print("Warning: could not connect to MongoDB:", e)

"""Safety-focused student mental health chatbot.

This service ONLY offers non-clinical coping strategies for students in higher education
and refers to professional help when appropriate. It must not provide diagnoses or
specialized medical advice.
"""

# Initialize Gemini model
model = genai.GenerativeModel("gemini-1.5-flash-8b")

# Crisis keywords list - only clear crisis indicators
CRISIS_KEYWORDS = [
    "suicide", "kill myself", "end my life", "self harm",
    "self-harm", "hurt myself", "no reason to live",
    "hang myself", "overdose", "jump off", "cut myself",
    "want to die", "going to kill", "planning to hurt",
    "thinking of suicide", "suicidal thoughts", "end it all"
]

# Topics that indicate student mental health context; if absent, nudge user
STUDENT_MH_KEYWORDS = [
    "stress", "anxiety", "depressed", "depression", "overwhelmed", "burnout",
    "panic", "lonely", "loneliness", "sleep", "insomnia", "exam", "exams",
    "test", "study", "studies", "assignment", "deadline", "semester",
    "university", "college", "campus", "roommate", "homesick", "worried",
    "worry", "fear", "scared", "nervous", "tired", "exhausted", "sad",
    "upset", "angry", "frustrated", "confused", "lost", "motivation",
    "concentration", "focus", "memory", "procrastination", "pressure",
    "performance", "grades", "academic", "social", "friendship", "relationship",
    "family", "home", "financial", "money", "job", "career", "future",
    "uncertainty", "change", "transition", "adjustment", "coping", "emotions",
    "feelings", "mental", "health", "wellbeing", "self-care", "therapy",
    "counseling", "support", "help", "struggling", "difficult", "hard",
    "challenging", "crisis", "emergency", "suicidal", "self-harm", "harm",
    "well", "unwell", "sick", "ill", "pain", "hurt", "ache", "symptoms",
    "mood", "moody", "irritable", "cranky", "miserable", "hopeless", "empty",
    "numb", "disconnected", "isolated", "withdrawn", "avoiding", "avoid",
    "procrastinate", "procrastinating", "unmotivated", "lazy", "unfocused",
    "distracted", "overthinking", "ruminating", "obsessing", "paranoid",
    "phobia", "phobic", "trauma", "traumatic", "ptsd", "panic attack",
    "breakdown", "meltdown", "triggered", "triggering", "flashback",
    "nightmare", "nightmares", "dreams", "dreaming", "night terrors"
]

# System-style guidance to constrain the LLM output to coping strategies only
COPING_SYSTEM_PROMPT = (
    "You are a supportive, non-clinical assistant for higher-education students. "
    "Your ONLY role is to offer practical, evidence-informed coping strategies for common student mental-health challenges "
    "(e.g., stress, anxiety, sleep difficulties, study overwhelm, loneliness). "
    "Do NOT diagnose or provide medical/legal advice. Keep a warm, validating tone. "
    "Prefer concise lists with actionable steps. Include:")

COPING_RESPONSE_STRUCTURE = (
    "\n- Start with a warm, brief greeting if the user greeted you\n"
    "- A brief validation (one sentence)\n"
    "- 3–5 concrete, low-risk coping strategies tailored to the user's situation\n"
    "- One immediate next step they can try now (breathing/grounding or similar)\n"
    "- Suggest campus or professional resources if concerns persist or affect safety/functioning\n"
    "- Short disclaimer that this is not a crisis or medical service\n"
)

# Basic greeting detection
GREETING_KEYWORDS = [
    "hi", "hello", "hey", "namaste", "good morning", "good afternoon", "good evening"
]

def detect_crisis(message: str) -> bool:
    """Check if the message contains clear crisis indicators."""
    message_lower = message.lower()
    
    # Check for exact matches first (highest priority for crisis detection)
    for keyword in CRISIS_KEYWORDS:
        if keyword in message_lower:
            return True
    
    # Check for fuzzy matches only for very specific crisis terms (higher threshold)
    high_risk_terms = ["suicide", "kill myself", "end my life", "self harm", "hurt myself"]
    return contains_fuzzy_keywords(message, high_risk_terms, threshold=0.85)

def looks_student_mh_related(message: str) -> bool:
    message_lower = message.lower()
    
    # Check for direct keyword matches (exact)
    if any(keyword in message_lower for keyword in STUDENT_MH_KEYWORDS):
        return True
    
    # Check for fuzzy keyword matches (handles typos)
    if contains_fuzzy_keywords(message, STUDENT_MH_KEYWORDS, threshold=0.7):
        return True
    
    # Check for common mental health phrases (exact)
    mental_health_phrases = [
        "not feeling", "don't feel", "feel bad", "feel terrible", "feel awful",
        "feel down", "feel low", "feel empty", "feel numb", "feel lost",
        "can't cope", "can't handle", "too much", "overwhelming", "breaking down",
        "falling apart", "losing it", "going crazy", "losing control",
        "need help", "need support", "need someone", "alone", "isolated",
        "no one understands", "no one gets it", "everyone else", "different",
        "not normal", "something wrong", "not myself", "not me anymore"
    ]
    
    if any(phrase in message_lower for phrase in mental_health_phrases):
        return True
    
    # Check for fuzzy phrase matches (handles typos in phrases)
    for phrase in mental_health_phrases:
        phrase_words = phrase.split()
        message_words = message_lower.split()
        
        # Check if all words in phrase have fuzzy matches in message
        matches = 0
        for phrase_word in phrase_words:
            for msg_word in message_words:
                clean_msg_word = ''.join(c for c in msg_word if c.isalnum())
                if fuzzy_match(clean_msg_word, [phrase_word], threshold=0.7):
                    matches += 1
                    break
        
        # If most words match, consider it a match
        if matches >= len(phrase_words) * 0.7:
            return True
    
    return False

def detect_greeting(message: str) -> bool:
    message_lower = message.lower().strip()
    return any(g in message_lower for g in GREETING_KEYWORDS)

def fuzzy_match(word: str, target_words: list, threshold: float = 0.7) -> bool:
    """Check if word matches any target word with fuzzy matching for typos."""
    word_lower = word.lower()
    
    # First try exact match
    if word_lower in [w.lower() for w in target_words]:
        return True
    
    # Then try fuzzy matching
    for target in target_words:
        target_lower = target.lower()
        similarity = SequenceMatcher(None, word_lower, target_lower).ratio()
        if similarity >= threshold:
            return True
    
    return False

def contains_fuzzy_keywords(message: str, keywords: list, threshold: float = 0.7) -> bool:
    """Check if message contains keywords with fuzzy matching."""
    words = message.lower().split()
    
    for word in words:
        # Remove punctuation for better matching
        clean_word = ''.join(c for c in word if c.isalnum())
        if fuzzy_match(clean_word, keywords, threshold):
            return True
    
    return False


@app.route("/")
def health():
	return jsonify({"status": "ok", "service": "mindsphere-server"})


@app.route("/", methods=["POST"])
def root_post():
	# Some platforms or misconfigured frontends POST to the site root.
	# Attempt to dispatch based on the JSON payload keys to a matching handler.
	data = request.get_json(silent=True) or {}
	if not isinstance(data, dict):
		return jsonify({"error": "invalid payload"}), 400

	# Route heuristics:
	if "text" in data:
		return api_chat()
	if "score" in data:
		return api_screenings()
	if "title" in data:
		return api_resources()
	if "name" in data and "time" in data:
		return api_bookings()
	if "text" in data:
		return api_forum()

	return jsonify({"error": "unrecognized payload"}), 400


@app.route("/api/bookings", methods=["GET", "POST"])
def api_bookings():
	if request.method == "POST":
		data = request.get_json() or {}
		entry = {"id": int(time.time() * 1000), "name": data.get("name", "anonymous"), "time": data.get("time")}
		bookings.append(entry)
		return jsonify({"ok": True, "id": entry["id"]}), 201
	return jsonify({"bookings": bookings})


@app.route("/api/resources", methods=["GET", "POST"])
def api_resources():
	if request.method == "POST":
		data = request.get_json() or {}
		title = data.get("title")
		if not title:
			return jsonify({"error": "title required"}), 400
		item = {
			"id": int(time.time() * 1000),
			"title": title,
			"type": data.get("type", "guide"),
			"language": data.get("language", "English"),
			"url": data.get("url", ""),
		}
		resources.insert(0, item)
		return jsonify(item), 201
	return jsonify({"resources": resources})


@app.route("/api/forum", methods=["GET", "POST"])
def api_forum():
	if request.method == "POST":
		data = request.get_json() or {}
		text = data.get("text")
		if not text:
			return jsonify({"error": "text required"}), 400
		post = {"id": int(time.time() * 1000), "text": text, "anon": True}
		forum_posts.insert(0, post)
		return jsonify(post), 201
	return jsonify({"posts": forum_posts})


@app.route("/api/screenings", methods=["GET", "POST"])
def api_screenings():
	if request.method == "POST":
		data = request.get_json() or {}
		score = data.get("score")
		if score is None:
			return jsonify({"error": "score required"}), 400
		entry = {"id": int(time.time() * 1000), "score": score}
		screenings.insert(0, entry)
		return jsonify({"ok": True}), 201
	return jsonify({"screenings": screenings})


@app.route("/api/admin", methods=["GET"])
def api_admin():
	# anonymized metrics
	metrics = {
		"activeUsers": 124,
		"screenings": len(screenings),
		"bookings": len(bookings),
		"forumPosts": len(forum_posts),
	}
	return jsonify(metrics)


<<<<<<< HEAD
# ----------------------------- PHQ-9 Endpoints -----------------------------

def _serialize_phq9(doc):
	if not doc:
		return None
	return {
		"user_email": doc.get("user_email"),
		"timestamp": doc.get("timestamp").isoformat() if isinstance(doc.get("timestamp"), datetime) else doc.get("timestamp"),
		"answers": doc.get("answers", []),
		"total_score": doc.get("total_score", 0),
	}


@app.route("/api/phq9", methods=["POST", "OPTIONS"])
def phq9_post():
    try:
        if request.method == "OPTIONS":
            return "", 204

        data = request.get_json() or {}
        user_email = data.get("user_email")
        answers = data.get("answers")
        if not user_email or not isinstance(answers, list) or len(answers) != 9:
            return jsonify({"error": "user_email and answers[9] are required"}), 400
        try:
            answers_int = [int(x) for x in answers]
        except Exception:
            return jsonify({"error": "answers must be integers"}), 400
        if len(answers_int) != 9:
            return jsonify({"error": "answers must be length 9"}), 400
        if any((x is None) or (x < 0) or (x > 3) for x in answers_int):
            return jsonify({"error": "answers must be integers 0-3"}), 400

        total_score = sum(answers_int)
        now = datetime.utcnow()

        doc = {
            "user_email": user_email.lower(),
            "timestamp": now,
            "answers": answers_int,
            "total_score": total_score,
        }

        # Optional: upsert if last record is within minutes to avoid duplicates from double clicks
        last = phq9_collection.find_one({"user_email": doc["user_email"]}, sort=[("timestamp", -1)])
        if last and isinstance(last.get("timestamp"), datetime) and (now - last["timestamp"]).total_seconds() < 60:
            phq9_collection.update_one({"_id": last["_id"]}, {"$set": doc})
            saved = phq9_collection.find_one({"_id": last["_id"]})
            return jsonify(_serialize_phq9(saved)), 200

        phq9_collection.insert_one(doc)
        return jsonify(_serialize_phq9(doc)), 201
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/phq9/<email>", methods=["GET", "OPTIONS"])
def phq9_get_latest(email: str):
    try:
        if request.method == "OPTIONS":
            return "", 204
        # Defensive: verify DB connection
        mongo_client.admin.command('ping')
        doc = phq9_collection.find_one({"user_email": email.lower()}, sort=[("timestamp", -1)])
        if not doc:
            return jsonify({}), 200
        return jsonify(_serialize_phq9(doc)), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500
=======
@app.route("/api/clients", methods=["GET"])
def api_clients():
	"""Return client-submitted form entries. If MongoDB is configured (MONGO_URI), read from 'clients' collection."""
	try:
		# If a mongo_db is available, read the documents
		if 'mongo_db' in globals() and mongo_db:
			coll = mongo_db.get_collection('clients')
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

		# Fallback sample
		sample = [{ 'id': 'sample-1', 'name': 'Student A', 'email': 'a@example.edu', 'submittedAt': '2025-01-01T10:00:00' }]
		return jsonify({'clients': sample})
	except Exception as e:
		return jsonify({'error': str(e)}), 500
>>>>>>> bcf35da (Add client fetching functionality to Counsellor Dashboard and implement MongoDB connection in API)


@app.route("/api/chat", methods=["POST", "OPTIONS"])
def api_chat():
	try:
		# Handle CORS preflight explicitly
		if request.method == "OPTIONS":
			return "", 204

		data = request.get_json() or {}
		user_message = data.get("message", "") or data.get("text", "")

		if not user_message:
			return jsonify({"error": "Message is required"}), 400

		# 🔹 Crisis detection
		if detect_crisis(user_message):
			crisis_response = (
				"⚠️ It sounds like you might be going through a very difficult time. "
				"You are not alone. I strongly encourage you to reach out right now:\n\n"
				"📞 In India, call Tele-MANAS at **14416** or **1-800-891-4416**\n"
				"📞 In the US, dial **988 Suicide & Crisis Lifeline**\n"
				"📞 Or call your local emergency number if you are in immediate danger.\n\n"
				"Would you like me to also connect you to a university counselor?"
			)
			return jsonify({
				"response": crisis_response,
				"reply": crisis_response,  # For backward compatibility
				"escalate": True
			})

		# 🔹 Quick friendly greeting if user only greets
		if detect_greeting(user_message) and len(user_message.strip()) <= 24:
			greet_text = (
				"Hello! I'm here to share practical coping strategies for stress and mental health. "
				"What's on your mind today? (e.g., exams, sleep, anxiety, motivation)"
			)
			return jsonify({"response": greet_text, "reply": greet_text, "escalate": False})

		# 🔹 Check if the question is mental health related
		if not looks_student_mh_related(user_message):
			redirect_response = (
				"I'm sorry, but I can't help with that topic. I'm specifically designed to support students with mental health concerns like stress, anxiety, depression, sleep issues, study problems, or emotional challenges.\n\n"
				"If you're dealing with any mental health struggles, academic stress, or emotional difficulties, I'd be happy to help you with coping strategies and support resources. What's troubling you today?"
			)
			return jsonify({"response": redirect_response, "reply": redirect_response, "escalate": False})

		# 🔹 Otherwise, request coping-only guidance from the model
		greeting_hint = "The user greeted you; open with a one-sentence friendly greeting." if detect_greeting(user_message) else ""
		coping_prompt = (
			f"{COPING_SYSTEM_PROMPT} {COPING_RESPONSE_STRUCTURE}\n\n"
			f"User context: {user_message}\n\n"
			"Constraints: Keep it concise and actionable; avoid diagnosis; encourage campus/pro help if needed; "
			"write for a university student audience; avoid high-risk instructions; no medical or legal advice."
			f" {greeting_hint}"
		)

		response = model.generate_content(coping_prompt)
		safe_text = (response.text or "")[:4000]

		return jsonify({
			"response": safe_text,
			"reply": safe_text,  # For backward compatibility
			"escalate": False
		})
	except Exception as e:
		return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
	app.run(port=5000, debug=True)
