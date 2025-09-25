from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
import os
from dotenv import load_dotenv

# Load API key
load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = Flask(__name__)
# Enable CORS for local dev (Vite on 5173 -> Flask on 5000)
CORS(app, resources={r"/*": {"origins": ["http://localhost:5173", "http://127.0.0.1:5173"]}}, supports_credentials=False)

"""Safety-focused student mental health chatbot.

This service ONLY offers non-clinical coping strategies for students in higher education
and refers to professional help when appropriate. It must not provide diagnoses or
specialized medical advice.
"""

# Initialize Gemini model
model = genai.GenerativeModel("gemini-1.5-flash")

# Crisis keywords list (expand as needed)
CRISIS_KEYWORDS = [
    "suicide", "kill myself", "end my life", "self harm",
    "self-harm", "hurt myself", "die", "worthless", "no reason to live",
    "hang myself", "overdose", "jump off", "cut myself"
]

# Topics that indicate student mental health context; if absent, nudge user
STUDENT_MH_KEYWORDS = [
    "stress", "anxiety", "depressed", "depression", "overwhelmed", "burnout",
    "panic", "lonely", "loneliness", "sleep", "insomnia", "exam", "exams",
    "test", "study", "studies", "assignment", "deadline", "semester",
    "university", "college", "campus", "roommate", "homesick"
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

def detect_crisis(message: str) -> bool:
    """Check if the message contains any crisis keywords."""
    message_lower = message.lower()
    return any(keyword in message_lower for keyword in CRISIS_KEYWORDS)


def looks_student_mh_related(message: str) -> bool:
    message_lower = message.lower()
    return any(keyword in message_lower for keyword in STUDENT_MH_KEYWORDS)

# Basic greeting detection
GREETING_KEYWORDS = [
    "hi", "hello", "hey", "namaste", "good morning", "good afternoon", "good evening"
]

def detect_greeting(message: str) -> bool:
    message_lower = message.lower().strip()
    return any(g in message_lower for g in GREETING_KEYWORDS)

@app.route("/chat", methods=["POST", "OPTIONS"])
def chat():
    try:
        # Handle CORS preflight explicitly
        if request.method == "OPTIONS":
            return "", 204

        data = request.json
        user_message = data.get("message", "")

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
                "escalate": True
            })

        # 🔹 Quick friendly greeting if user only greets
        if detect_greeting(user_message) and len(user_message.strip()) <= 24:
            greet_text = (
                "Hello! I’m here to share practical coping strategies for stress and mental health. "
                "What’s on your mind today? (e.g., exams, sleep, anxiety, motivation)"
            )
            return jsonify({"response": greet_text, "escalate": False})

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
            "escalate": False
        })
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(port=5000, debug=True)
