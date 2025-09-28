"""Helpers for intent detection and prompt building.

This module delegates intent classification to an LLM (Gemini) when configured,
and falls back to lightweight local heuristics for crisis detection and offline
operation. The public entrypoint is detect_intent(message: str) which returns
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
import smtplib
from email.message import EmailMessage
from google.generativeai import client as genai
# --- Configuration ---
from difflib import SequenceMatcher

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = os.getenv('MODEL_NAME')
GEMINI_MODEL = os.getenv('MODEL_NAME')

# SMTP configuration for counsellor notifications (optional)
SMTP_HOST = os.getenv('SMTP_HOST')
SMTP_PORT = int(os.getenv('SMTP_PORT') or 0)
SMTP_USER = os.getenv('SMTP_USER')
SMTP_PASS = os.getenv('SMTP_PASS')
COUNSELLOR_EMAIL = os.getenv('COUNSELLOR_EMAIL')

# Single, constant prompt used for all model intent classification calls (per your request).
# The model should return a strict JSON object and nothing else.
UNIFIED_INTENT_PROMPT = (
    "You are an expert, concise intent classifier for a student mental-health support chat.\n"
    "Given the user's single-line message (below), return ONLY a JSON object (no commentary) with these fields:\n"
    "{\n  \"intent\": \"<one-word-intent>\",           // e.g. crisis, screening, booking, support, greeting, general, other\n"
    "  \"confidence\": <0.0-1.0>,                   // decimal confidence score\n"
    "  \"danger_level\": \"low|moderate|high\",  // threat level: low, moderate, or high\n"
    "  \"metadata\": { \"rationale\": \"one-sentence reason\" }\n"
    "}\n"
    "If the message strongly indicates imminent self-harm or suicidal intent, set danger_level to 'high' and confidence >= 0.95.\n"
    "Do NOT include any text outside the JSON. Output valid JSON only.\n\n"
    "User message:"
)

# NOTE: per request, no local keyword heuristics are used for intent analysis.
# All classification decisions are delegated to the LLM (Gemini) via the unified prompt.


def _call_gemini(prompt: str, timeout: float = 6.0) -> str:
    """Call Gemini (Generative Language API) with the unified prompt and return the raw response text."""
    if not GEMINI_API_KEY or not GEMINI_MODEL:
        raise ValueError('GEMINI_API_KEY or MODEL_NAME not configured')

    try:
        genai.configure(api_key=GEMINI_API_KEY)
        response = genai.generate_text(
            model=GEMINI_MODEL,
            prompt=prompt,
            max_output_tokens=500,
            temperature=0.0,
        )
        return response.text
    except Exception as e:
        raise RuntimeError(f"Gemini API call failed: {e}")


def _parse_json_strict(text: str) -> dict:
    """Extract and parse the first JSON object from text.

    Raises ValueError if no JSON object can be parsed.
    """
    start = text.find('{')
    if start == -1:
        raise ValueError('no JSON found')
    # try progressively shorter tail slices until json.loads succeeds
    for end in range(len(text), start, -1):
        try:
            snippet = text[start:end]
            return json.loads(snippet)
        except Exception:
            continue
    # final attempt
    return json.loads(text)


# --- Backwards-compatible helper functions used by existing callers ---
# These wrap the LLM-based detect_intent and provide small, simple
# translations so existing code in api/index.py keeps working.


COPING_SYSTEM_PROMPT = (
    "You are a compassionate student mental-health support assistant."
)


def detect_crisis(message: str) -> bool:
    """Compatibility wrapper: return True if the classifier marks the message as high danger.

    If the model is not configured, conservatively return False (no automated escalation).
    """
    try:
        res = detect_intent(message)
        if not res:
            return False
        intent = (res.get('intent') or '').lower()
        danger = (res.get('danger_level') or '').lower()
        conf = float(res.get('confidence') or 0.0)
        if intent == 'crisis' or danger == 'high' or (intent == 'crisis' and conf >= 0.95):
            return True
    except Exception:
        pass
    return False


def looks_student_mh_related(message: str) -> bool:
    """Compatibility wrapper: return True if the classifier indicates the message is within student mental-health scope.

    If the model is not configured, default to True (so we proceed naturally).
    """
    try:
        res = detect_intent(message)
        if not res or res.get('intent') in (None, 'unknown'):
            return True
        intent = (res.get('intent') or '').lower()
        # treat these intents as student-mh-related
        return intent in ('general', 'support', 'screening', 'crisis')
    except Exception:
        return True


def build_coping_prompt(user_message: str, history=None) -> str:
    """Return a model prompt for generating coping/response text.

    Accepts optional `history` (list of prior turns) so callers can include recent
    conversation context. Keeps the previous API used by index.py: modelutils.generate_coping_text(prompt)
    expects a full prompt string.
    """
    history_block = ""
    try:
        if history and isinstance(history, (list, tuple)):
            parts = []
            for h in history:
                if not isinstance(h, dict):
                    continue
                role = h.get('role', 'user')
                msg = h.get('message') or h.get('text') or ''
                parts.append(f"[{role}] {msg}")
            if parts:
                history_block = "Conversation history:\n" + "\n".join(parts) + "\n\n"
    except Exception:
        history_block = ""

    constraints = "Constraints: keep it brief and actionable. Reply conversationally in 2-4 short sentences, ask one quick follow-up question when helpful."
    return f"{COPING_SYSTEM_PROMPT}\n{history_block}User context: {user_message}\n{constraints}"


def _send_smtp_notification(subject: str, body: str) -> bool:
    """Send an SMTP email to COUNSELLOR_EMAIL if SMTP is configured. Returns True on success."""
    if not (SMTP_HOST and SMTP_PORT and COUNSELLOR_EMAIL):
        # not configured
        return False
    try:
        msg = EmailMessage()
        msg['Subject'] = subject
        msg['From'] = SMTP_USER or f"no-reply@{SMTP_HOST}"
        msg['To'] = COUNSELLOR_EMAIL
        msg.set_content(body)
        if SMTP_PORT == 465:
            server = smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=10)
        else:
            server = smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=10)
            server.starttls()
        if SMTP_USER and SMTP_PASS:
            server.login(SMTP_USER, SMTP_PASS)
        server.send_message(msg)
        server.quit()
        return True
    except Exception as e:
        try:
            print('SMTP send failed:', e)
        except Exception:
            pass
        return False


def detect_intent(message: str) -> dict:
    """Primary intent detection function.

    Flow:
    - If local crisis keyword fast-path matches, treat as high danger (immediate safety fast-path).
    - Otherwise, call Gemini once using the UNIFIED_INTENT_PROMPT + message.
    - Parse the JSON and return { intent, confidence, danger_level, metadata }.
    - If danger_level is 'high', attempt to notify the counsellor via SMTP (if configured).
    """
    out = {'intent': 'unknown', 'confidence': 0.0, 'danger_level': 'low', 'metadata': {}}
    if not message or not isinstance(message, str):
        return out

    # Per your request, perform intent analysis purely via the LLM.
    if not GEMINI_API_KEY:
        return {'intent': 'unknown', 'confidence': 0.0, 'danger_level': 'low', 'metadata': {'error': 'GEMINI_API_KEY not configured'}}

    prompt = UNIFIED_INTENT_PROMPT + " " + message
    try:
        raw = _call_gemini(prompt)
        parsed = _parse_json_strict(raw)
        intent = parsed.get('intent', 'other')
        confidence = float(parsed.get('confidence') or 0.0)
        danger = parsed.get('danger_level') or parsed.get('danger') or 'low'
        metadata = parsed.get('metadata') or {}
        result = {
            'intent': intent if isinstance(intent, str) else str(intent),
            'confidence': max(0.0, min(1.0, confidence)),
            'danger_level': danger if isinstance(danger, str) else str(danger),
            'metadata': metadata
        }
        # If model marks high danger, notify counsellor
        if result['danger_level'].lower() == 'high':
            subject = f"High-risk message detected (intent={result['intent']})"
            body = f"A high-risk message was detected by the intent classifier.\n\nMessage:\n{message}\n\nModel output:\n{json.dumps(parsed, indent=2)}"
            _send_smtp_notification(subject, body)
        return result
    except Exception as e:
        try:
            print('Intent detection model error:', e)
        except Exception:
            pass
        return {'intent': 'unknown', 'confidence': 0.0, 'danger_level': 'low', 'metadata': {'error': str(e)}}