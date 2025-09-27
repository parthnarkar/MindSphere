from difflib import SequenceMatcher
from datetime import datetime

CRISIS_KEYWORDS = [
    "suicide", "kill myself", "end my life", "self harm",
    "self-harm", "hurt myself", "no reason to live",
    "hang myself", "overdose", "jump off", "cut myself",
    "want to die", "going to kill", "planning to hurt",
    "thinking of suicide", "suicidal thoughts", "end it all"
]

STUDENT_MH_KEYWORDS = [
    # common problems & student context
    "stress", "anxiety", "depressed", "depression", "overwhelmed", "burnout",
    "panic", "panic attack", "lonely", "loneliness", "sleep", "insomnia", "tired", "exhausted",
    "exam", "exams", "test", "study", "studies", "assignment", "deadline", "semester",
    "grade", "grades", "motivation", "motivation", "concentration", "focus", "procrastination",
    "homesick", "roommate", "relationship", "breakup", "friend", "friends", "social", "isolation",
    "financial", "money", "job", "career", "future", "uncertainty", "identity",
    "help", "support", "therapy", "counselor", "counsellor", "counselling", "suicidal", "suicide",
    # common adjectives/variants
    "anxious", "anxiety", "stressed", "stressing",
]

COPING_SYSTEM_PROMPT = (
    "You are a supportive, non-clinical assistant for higher-education students. "
    "Your ONLY role is to offer practical, evidence-informed coping strategies for common student mental-health challenges."
)

def fuzzy_match(word, target_words, threshold=0.7):
    w = word.lower()
    for t in target_words:
        if SequenceMatcher(None, w, t.lower()).ratio() >= threshold:
            return True
    return False

def detect_crisis(message: str) -> bool:
    ml = message.lower()
    for k in CRISIS_KEYWORDS:
        if k in ml:
            return True
    return fuzzy_match(ml, CRISIS_KEYWORDS, threshold=0.85)

def looks_student_mh_related(message: str) -> bool:
    import re

    ml = message.lower()

    # Direct keyword matches (fast path)
    if any(k in ml for k in STUDENT_MH_KEYWORDS):
        return True

    # Heuristic: first-person statement combined with emotional verbs/words
    pronouns = [" i ", " i'm ", " i'm", "im ", "i'm", "i am ", " me ", " my "]
    emotional_terms = ["feel", "feeling", "felt", "struggling", "stress", "stressed", "anxious", "anxiety", "sad", "depress", "alone", "lonely", "panic", "can't", "cannot", "cant", "overwhelmed", "suicid"]
    if any(p in f" {ml} " for p in pronouns) and any(e in ml for e in emotional_terms):
        return True

    # Short messages that contain a clear emotional keyword should be considered MH-related
    words = ml.split()
    if len(words) <= 4 and any(e in ml for e in emotional_terms + ["help", "support", "therapy", "suicide", "suicidal"]):
        return True

    # Fuzzy token-wise matching to catch typos or morphological variants
    tokens = re.findall(r"\w+", ml)
    for t in tokens:
        if fuzzy_match(t, STUDENT_MH_KEYWORDS, threshold=0.75):
            return True

    return False

def build_coping_prompt(user_message: str) -> str:
    return f"{COPING_SYSTEM_PROMPT}\nUser context: {user_message}\nConstraints: keep it brief and actionable."
