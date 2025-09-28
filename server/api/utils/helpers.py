"""Helpers for intent detection and prompt building.

This module delegates intent classification to an LLM (Gemini) when configured,
and falls back to lightweight local heuristics for crisis detection and offline
operation. The public entrypoint is `detect_intent(message: str)` which returns
a dict: { 'intent': str, 'confidence': float, 'metadata': {...} }.

Configuration (environment variables):
- GEMINI_API_KEY: API key for the Google Generative Models API (optional)

Notes:
- We keep a local fast-path for crisis detection to ensure immediate, deterministic
  handling of safety-sensitive messages even when the external API is unavailable.
"""

from datetime import datetime
import json
import os
import re
import requests
from difflib import SequenceMatcher

# --- Configuration ---
GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = os.getenv('MODEL_NAME')

# Keyword lists for local heuristics (kept small and conservative)
CRISIS_KEYWORDS = [
    "suicide", "kill myself", "end my life", "self harm", "self-harm",
    "hurt myself", "no reason to live", "hang myself", "overdose",
    "cut myself", "want to die", "suicidal thoughts"
]

STUDENT_MH_KEYWORDS = [
    "stress", "anxiety", "depress", "depression", "overwhelmed", "burnout",
    "panic", "lonely", "sleep", "insomnia", "exam", "deadline", "grade",
    "motivation", "concentration", "procrastination", "homesick", "relationship",
    "support", "therapy", "counselor"
]


# --- Utilities ---
def _fuzzy_match(token: str, targets, threshold=0.75):
    t = token.lower()
    for candidate in targets:
        if SequenceMatcher(None, t, candidate.lower()).ratio() >= threshold:
            return True
    return False


# --- Local fast-paths (deterministic, safety-critical) ---
def detect_crisis_local(message: str) -> bool:
    """Return True if the message contains a crisis indicator (fast and local)."""
    if not message or not isinstance(message, str):
        return False
    ml = message.lower()
    for kw in CRISIS_KEYWORDS:
        if kw in ml:
            return True
    # conservative fuzzy check on tokens
    tokens = re.findall(r"\w+", ml)
    for tk in tokens:
        if _fuzzy_match(tk, CRISIS_KEYWORDS, threshold=0.9):
            return True
    return False


def looks_student_mh_related_local(message: str) -> bool:
    """Lightweight heuristic to decide if the message looks like student MH content."""
    if not message or not isinstance(message, str):
        return False
    ml = message.lower()
    if any(k in ml for k in STUDENT_MH_KEYWORDS):
        return True
    tokens = re.findall(r"\w+", ml)
    for tk in tokens:
        if _fuzzy_match(tk, STUDENT_MH_KEYWORDS, threshold=0.8):
            return True
    # small personal statements with emotional verbs
    if re.search(r"\b(i\b|i'm|i am|me|my)\b", ml) and re.search(r"\b(feel|feeling|sad|anxious|stressed|overwhelmed)\b", ml):
        return True
    return False


# --- Gemini integration ---
def _call_gemini_intent_api(prompt: str):
    """Call the configured Gemini model and return the raw text output.

    This uses the Google Generative Models REST endpoint. The function expects
    GEMINI_API_KEY to be set as an env var. If not configured it raises RuntimeError.
    """
    if not GEMINI_API_KEY:
        raise RuntimeError('GEMINI_API_KEY not configured')

    # Construct endpoint — this matches the Google generative API pattern
    endpoint = f"https://generativelanguage.googleapis.com/v1beta2/{GEMINI_MODEL}:generate?key={GEMINI_API_KEY}"
    payload = {
        "prompt": {"text": prompt},
        "temperature": 0.0,
        "maxOutputTokens": 256,
    }
    headers = {"Content-Type": "application/json"}
    resp = requests.post(endpoint, json=payload, headers=headers)
    resp.raise_for_status()
    data = resp.json()

    # The generative response usually lives under 'candidates' or 'output' variations —
    # attempt common locations, then fallback to joining top-level strings.
    text = None
    if isinstance(data, dict):
        if 'candidates' in data and isinstance(data['candidates'], list) and data['candidates']:
            text = data['candidates'][0].get('content') or data['candidates'][0].get('output')
        elif 'output' in data:
            # some API variants return output[0].content
            out = data.get('output')
            if isinstance(out, list) and out:
                text = out[0].get('content') or out[0].get('text')
        elif 'candidates' in data and isinstance(data['candidates'], dict):
            text = data['candidates'].get('content')

    if not text:
        # Last resort: stringify the response
        text = json.dumps(data)
    return text


def _build_intent_prompt(message: str):
    """Construct a concise prompt asking Gemini to return JSON with intent and confidence.

    The assistant is instructed to output a strict JSON object with keys: intent, confidence
    (0.0-1.0), and optional metadata. The function asks for a short rationale in metadata.
    """
    instructions = (
        "You are a small, precise intent classification assistant for a student mental-\n"
        "health support chat. Given the user's single-line message, return a JSON object with the exact\n"
        "shape: {\n  \"intent\": \"<one-word-intent>\",\n  \"confidence\": <0.0-1.0>,\n  \"metadata\": { ... optional ... }\n}\n" 
        "Do NOT include any extra commentary outside the JSON. Use these intent labels: crisis, screening, booking, support, greeting, general, other.\n"
        "If you are very confident the message indicates imminent self-harm or suicidal ideation, return intent 'crisis' with confidence >= 0.95.\n"
        "Also include metadata.rationale with a one-sentence reason for the classification.\n"
    )
    prompt = f"{instructions}\nUser message: {message}\nOutput JSON:" 
    return prompt


def _parse_model_json(candidate_text: str):
    """Try to extract JSON from the model output and parse it to a dict.

    Returns a dict on success or raises ValueError.
    """
    # Find first { ... } block
    start = candidate_text.find('{')
    if start == -1:
        raise ValueError('No JSON object found in model output')
    # try progressively larger slices until valid JSON
    for end in range(len(candidate_text), start, -1):
        try:
            snippet = candidate_text[start:end]
            parsed = json.loads(snippet)
            return parsed
        except Exception:
            continue
    # final attempt: try to load entire string
    return json.loads(candidate_text)


def detect_intent(message: str):
    """Master intent detection function.

    Behavior:
    - If message appears to be a crisis (local fast-path), return {'intent':'crisis', 'confidence': 0.99}
    - Otherwise, if GEMINI_API_KEY is configured, ask Gemini to classify and return its parsed JSON.
    - If Gemini is unavailable or parsing fails, fall back to a conservative local heuristic.

    Returns: { 'intent': str, 'confidence': float, 'metadata': dict }
    """
    out = {'intent': 'unknown', 'confidence': 0.0, 'metadata': {}}
    if not message or not isinstance(message, str):
        return out

    # Local crisis fast-path (deterministic)
    try:
        if detect_crisis_local(message):
            return {'intent': 'crisis', 'confidence': 0.99, 'metadata': {'rationale': 'matched crisis keywords locally'}}
    except Exception:
        # non-fatal: continue to model path
        pass

    # Try model-based classification when configured
    if GEMINI_API_KEY:
        try:
            prompt = _build_intent_prompt(message)
            raw = _call_gemini_intent_api(prompt)
            parsed = _parse_model_json(raw)
            intent = parsed.get('intent') if isinstance(parsed.get('intent'), str) else str(parsed.get('intent') or 'other')
            confidence = float(parsed.get('confidence') or parsed.get('score') or 0.0)
            metadata = parsed.get('metadata') or {}
            # normalize
            intent = intent.lower()
            if confidence < 0.0 or confidence > 1.0:
                # clamp
                confidence = max(0.0, min(1.0, confidence))
            return {'intent': intent, 'confidence': confidence, 'metadata': metadata}
        except Exception as e:
            # Log and fall back to local heuristics
            try:
                print('Gemini intent detection failed:', str(e))
            except Exception:
                pass

    # Conservative local fallback
    try:
        ml = message.lower()
        if looks_student_mh_related_local(message):
            return {'intent': 'general', 'confidence': 0.6, 'metadata': {'rationale': 'local student-MH heuristic'}}
        if any(x in ml for x in ['phq', 'depress', 'anxiet', 'screening', 'assessment']):
            return {'intent': 'screening', 'confidence': 0.6, 'metadata': {}}
        if any(w in ml for w in ['book', 'appointment', 'schedule', 'reserve', 'meet']):
            return {'intent': 'booking', 'confidence': 0.6, 'metadata': {}}
        if any(w in ml for w in ['cope', 'coping', 'strategy', 'resource', 'tips', 'advice']):
            return {'intent': 'support', 'confidence': 0.6, 'metadata': {}}
        if any(w in ml for w in ['hi', 'hello', 'hey']):
            return {'intent': 'greeting', 'confidence': 0.6, 'metadata': {}}
    except Exception:
        pass

    return {'intent': 'other', 'confidence': 0.5, 'metadata': {}}

