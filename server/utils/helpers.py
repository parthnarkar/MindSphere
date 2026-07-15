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

import json
import os
import re
import requests
import json
import html

# reuse model response extraction utilities
from datetime import datetime
from difflib import SequenceMatcher
from .model import _extract_text, _coerce_to_string
from . import db as dbutils
from . import model as modelutils

# --- Configuration ---
try:
    import google.generativeai as genai
except Exception:
    genai = None

GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = os.getenv('MODEL_NAME')


# Single, constant prompt used for all model intent classification calls (per your request).
# The model should return a strict JSON object and nothing else.
UNIFIED_INTENT_PROMPT = (
    "You are an expert, precise and conservative intent classifier.\n"
    "Task: Given a user message, RETURN ONLY a single valid JSON object (no commentary, no extra text) that exactly matches the schema below.\n"
    "Schema (required):\n"
    "{\n"
    "  \"intent\": \"<one-word-intent>\",         // Example: support, screening, booking, greeting, general or any that can be inferred\n"
    "  \"confidence\": <0.0-1.0>,                     // probability (0.0 to 1.0), two-decimal precision preferred\n"
    "  \"danger_level\": \"low|moderate|high\",  // choose exactly one: low, moderate, or high\n"
    "  \"metadata\": {                                // additional structured info\n"
    "    \"rationale\": \"one-sentence reason (mention key words/phrases)\",\n"
    "    \"indicators\": [ /* short tokens (1-3) e.g. 'concern', 'stress', 'anxiety' or anything that can be inferred */ ]\n"
    "  }\n"
    "}\n"
    "Rules and calibration (follow exactly):\n"
    "- Always output valid JSON only. Do not include any explanatory text, headings, or notes.\n"
    "- Intent can be anything that is predictable from the user message.\n"
    "- Confidence is a decimal probability in [0.0, 1.0]. For high danger, set confidence >= 0.95. For uncertain outputs use confidence near 0.0.\n"
    "- Danger level mapping guidance (be conservative):\n"
    "    * high: explicit indications of distress or concern.\n"
    "    * moderate: expressions of concern but without clear immediacy.\n"
    "    * low: general distress or requests for support that do NOT indicate immediate concern.\n"
    "- In the metadata.rationale provide a concise one-sentence reason citing the key words/phrases that led to the classification.\n"
    "- In metadata.indicators include 0..3 short tokens that indicate signals, e.g. [\"concern\", \"stress\", \"anxiety\"] or [] if none.\n"
    "- Do NOT add any extra fields beyond the schema above.\n"
    "If the message indicates significant concern, set \"danger_level\" to \"high\" and confidence >= 0.95.\n"
    "If the model cannot produce valid JSON, try again once and still return only JSON. If still failing, return: {\"intent\": \"unknown\", \"confidence\": 0.0, \"danger_level\": \"low\", \"metadata\": {\"rationale\": \"model_parse_failure\", \"indicators\": []}}\n\n"
    "Examples (for calibration only) — these are examples of the exact JSON you should return for the sample messages: \n"
    "User message: \"I feel overwhelmed and need help\"\n"
    "Expected JSON: {\"intent\": \"support\", \"confidence\": 0.85, \"danger_level\": \"low\", \"metadata\": {\"rationale\": \"expresses need for support\", \"indicators\": [\"overwhelmed\"]}}\n"
    "User message: \"I am really stressed about my exams\"\n"
    "Expected JSON: {\"intent\": \"general\", \"confidence\": 0.75, \"danger_level\": \"low\", \"metadata\": {\"rationale\": \"expresses stress about exams\", \"indicators\": [\"stress\"]}}\n\n"
    "Now classify the following single-line User message. Output ONLY the JSON object exactly matching the schema above (no surrounding text).\n\n"
    "User message:"
)

# NOTE: per request, no local keyword heuristics are used for intent analysis.
# All classification decisions are delegated to the LLM (Gemini) via the unified prompt.


def _call_gemini(prompt: str, timeout: float = 6.0) -> str:
    """Call Gemini (Generative Language API) with the unified prompt and return the raw response text."""
    # Prefer the initialized model client from modelutils if present; fall back to local genai import
    client = getattr(modelutils, 'client', None) or genai
    model_name = getattr(modelutils, 'model_name', None) or GEMINI_MODEL

    if client is None or not model_name:
        raise ValueError('Gemini client or model not configured')

    # Try multiple call surfaces and allow one retry when response is empty
    last_err = None
    attempts = 2
    for attempt in range(attempts):
        try:
            # If the client offers a configure hook and an API key is present, ensure configured
            try:
                if GEMINI_API_KEY and hasattr(client, 'configure'):
                    client.configure(api_key=GEMINI_API_KEY)
            except Exception:
                pass

            # Modern API: generate(model=..., input=...)
            if hasattr(client, 'generate'):
                resp = client.generate(model=model_name, input=prompt, max_output_tokens=500, temperature=0.0)
                text = _extract_text(resp)
                text = _coerce_to_string(text)
                if text and isinstance(text, str) and text.strip():
                    return text

            # Alternate: generate_text
            if hasattr(client, 'generate_text'):
                try:
                    resp = client.generate_text(model=model_name, prompt=prompt, max_output_tokens=500, temperature=0.0)
                except TypeError:
                    resp = client.generate_text(model=model_name, text=prompt, max_output_tokens=500, temperature=0.0)
                text = _extract_text(resp)
                text = _coerce_to_string(text)
                if text and isinstance(text, str) and text.strip():
                    return text

            # Older wrapper object: GenerativeModel
            if hasattr(client, 'GenerativeModel'):
                try:
                    gm = client.GenerativeModel(model_name)
                    if hasattr(gm, 'generate_content'):
                        out = gm.generate_content(prompt)
                        text = _extract_text(out)
                        text = _coerce_to_string(text)
                        if text and isinstance(text, str) and text.strip():
                            return text
                    if hasattr(gm, 'generate'):
                        out = gm.generate(prompt)
                        text = _extract_text(out)
                        text = _coerce_to_string(text)
                        if text and isinstance(text, str) and text.strip():
                            return text
                except Exception:
                    pass

            # If we reached here without a non-empty text, raise to trigger retry/outer error handling
            raise RuntimeError('Model returned empty or unsupported response')
        except Exception as e:
            last_err = e
            # small backoff between attempts
            if attempt + 1 < attempts:
                try:
                    import time
                    time.sleep(0.3)
                except Exception:
                    pass
            continue
    # If we exit loop, raise last error
    raise RuntimeError(f"Gemini API call failed: {last_err}")


def _parse_json_strict(text: str) -> dict:
    """Extract and parse the first JSON object from text.

    Raises ValueError if no JSON object can be parsed.
    """
    if not text or not isinstance(text, str):
        raise ValueError('no text to parse')

    def _extract_json_from_position(s: str, start_idx: int) -> str:
        """Try to extract a JSON object starting at start_idx using brace matching.
        Returns the substring if a balanced object is found, otherwise empty string."""
        depth = 0
        in_str = False
        esc = False
        quote_char = None
        for i in range(start_idx, len(s)):
            ch = s[i]
            if in_str:
                if esc:
                    esc = False
                    continue
                if ch == '\\':
                    esc = True
                    continue
                if ch == quote_char:
                    in_str = False
                    quote_char = None
                    continue
                continue
            else:
                if ch == '"' or ch == "'":
                    in_str = True
                    quote_char = ch
                    esc = False
                    continue
                if ch == '{':
                    depth += 1
                elif ch == '}':
                    depth -= 1
                    if depth == 0:
                        return s[start_idx:i+1]
        return ''

    # Attempt to extract JSON from common wrapper patterns first:
    # 1) Triple-backtick fenced blocks (```json ... ```)
    # 2) Quoted text fields (e.g., parts { text: "..." }) where the JSON may be inside the quoted string
    try:
        # Try to unescape common escape sequences so that embedded JSON inside quoted strings
        # becomes parseable (e.g. "\n" -> newline, escaped quotes -> real quotes).
        try:
            unescaped = bytes(text, 'utf-8').decode('unicode_escape')
        except Exception:
            unescaped = text

        # 1) fenced code block search (```json ... ``` or ``` ... ```)
        import re
        fenced = re.search(r'```(?:json)?\s*(\{.*?\})\s*```', unescaped, re.DOTALL | re.IGNORECASE)
        if fenced:
            candidate = fenced.group(1)
            try:
                return json.loads(candidate)
            except Exception:
                # try to clean the candidate by unescaping again
                try:
                    cand2 = bytes(candidate, 'utf-8').decode('unicode_escape')
                    return json.loads(cand2)
                except Exception:
                    pass

        # 2) Extract quoted text fields and attempt to parse JSON inside them
        # Find all quoted strings; these may contain the JSON when the SDK wrapped it
        quoted = re.findall(r'"((?:\\.|[^"\\])*)"', text, re.DOTALL)
        for q in quoted:
            try:
                q_un = bytes(q, 'utf-8').decode('unicode_escape')
            except Exception:
                q_un = q
            # if there's a brace in the unescaped quoted string, try to extract JSON inside it
            if '{' in q_un:
                # try brace-matching on the quoted string
                def _extract_from_str(s):
                    depth = 0
                    in_str = False
                    esc = False
                    quote_char = None
                    start_idx = None
                    for i, ch in enumerate(s):
                        if in_str:
                            if esc:
                                esc = False
                                continue
                            if ch == '\\':
                                esc = True
                                continue
                            if ch == quote_char:
                                in_str = False
                                quote_char = None
                                continue
                            continue
                        else:
                            if ch == '"' or ch == "'":
                                in_str = True
                                quote_char = ch
                                esc = False
                                continue
                            if ch == '{':
                                if start_idx is None:
                                    start_idx = i
                                depth += 1
                            elif ch == '}':
                                depth -= 1
                                if depth == 0 and start_idx is not None:
                                    return s[start_idx:i+1]
                    return ''

                candidate = _extract_from_str(q_un)
                if candidate:
                    try:
                        return json.loads(candidate)
                    except Exception:
                        try:
                            return json.loads(bytes(candidate, 'utf-8').decode('unicode_escape'))
                        except Exception:
                            pass
    except Exception:
        # non-fatal; fall through to general scanning
        pass

    # Scan for every '{' occurrence and try to parse a JSON object starting there.
    idx = 0
    while True:
        idx = text.find('{', idx)
        if idx == -1:
            break
        candidate = _extract_json_from_position(text, idx)
        if candidate:
            try:
                return json.loads(candidate)
            except Exception:
                # try next occurrence
                idx = idx + 1
                continue

    # Fallback: progressive slicing (legacy behavior)
    start = text.find('{')
    if start == -1:
        raise ValueError('no JSON found')
    for end in range(len(text), start, -1):
        try:
            snippet = text[start:end]
            return json.loads(snippet)
        except Exception:
            continue
    # final attempt on whole text
    return json.loads(text)


# --- Backwards-compatible helper functions used by existing callers ---
# These wrap the LLM-based detect_intent and provide small, simple
# translations so existing code in api/index.py keeps working.


COPING_SYSTEM_PROMPT = (
    "You are knowledgeable and intelligent AI assistant"
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

    return f"{COPING_SYSTEM_PROMPT}\n{history_block}User context: {user_message}\n"

# Notification helpers (email/SMS) have been removed from this module.
# Use a dedicated notifications service or a background worker to send alerts.


def detect_intent(message: str) -> dict:
    """Primary intent detection function.

    Flow:
    - If local crisis keyword fast-path matches, treat as high danger (immediate safety fast-path).
    - Otherwise, call Gemini once using the UNIFIED_INTENT_PROMPT + message.
    - Parse the JSON and return { intent, confidence, danger_level, metadata }.
    """
    out = {'intent': 'unknown', 'confidence': 0.0, 'danger_level': 'low', 'metadata': {}}
    if not message or not isinstance(message, str):
        return out

    # Per your request, perform intent analysis purely via the LLM.
    # Ensure we have a live model client at call time. Prefer an already-initialized
    # client (useful for tests which inject modelutils.client). If nothing is set,
    # attempt to initialize using modelutils.init_model(). If still unavailable,
    # return 'unknown' with metadata (no local heuristics used).
    if not getattr(modelutils, 'client', None) or not getattr(modelutils, 'model_name', None):
        try:
            modelutils.init_model()
        except Exception:
            pass
    if not getattr(modelutils, 'client', None) or not getattr(modelutils, 'model_name', None):
        return {'intent': 'unknown', 'confidence': 0.0, 'danger_level': 'low', 'metadata': {'error': 'Gemini client not configured'}}

    prompt = UNIFIED_INTENT_PROMPT + " " + message
    try:
        raw = _call_gemini(prompt)
        # Defensive: if the model returns an empty string or whitespace, avoid json parsing
        if not raw or not isinstance(raw, str) or not raw.strip():
            raise ValueError('empty response from model')
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
        # Determine a simple safety flag for downstream callers. Mark as unsafe
        # when the model indicates moderate/high danger or explicitly labels the intent as 'crisis'.
        try:
            dl = (result.get('danger_level') or 'low').lower()
            it = (result.get('intent') or '').lower()
            result['unsafe'] = dl in ('moderate', 'high') or it == 'crisis'
            result['safe'] = not result['unsafe']
        except Exception:
            result['unsafe'] = False
            result['safe'] = True
        # If model marks high danger, mark the result for external escalation.
        
        if result['danger_level'].lower() == 'high':
            md = result.get('metadata') or {}
            md['escalation_required'] = True
            md['escalation_note'] = 'High danger detected; escalate externally'
            result['metadata'] = md
        return result
    except Exception as e:
        # Do NOT print errors; instead collect metadata and attempt one recovery pass
        meta = {'error_first': str(e)}
        try:
            if 'raw' in locals() and isinstance(raw, str) and raw.strip():
                meta['model_raw_snippet'] = raw.strip()[:2000]
        except Exception:
            pass

        
        # Final fallback: return unknown with metadata
        return {'intent': 'unknown', 'confidence': 0.0, 'danger_level': 'low', 'metadata': meta}


def generate_structured_report(user_meta: dict, phq_entries: list, chat_msgs: list, posts: list, resources: list) -> str:
    """Deterministically generate a counselor-friendly report in Markdown.

    Formatting rules applied:
    - Title as a top-level heading (client will center the title when rendering PDF).
    - Sections: Screening Information (PHQ-9), Chatbot History Summary, Peer-to-Peer Posts, Resource Finder Search History.
    - Each section uses a short header and long bullet points summarizing only the supplied data.
    - No filler or invented facts; summarizes only what's present in the inputs.

    Returns a Markdown string.
    """
    phq_map = {0: 'Not at all', 1: 'Several days', 2: 'More than half the days', 3: 'Nearly every day'}

    # Standard PHQ-9 question texts
    phq_questions = [
        "Little interest or pleasure in doing things",
        "Feeling down, depressed, or hopeless",
        "Trouble falling or staying asleep, or sleeping too much",
        "Feeling tired or having little energy",
        "Poor appetite or overeating",
        "Feeling bad about yourself — or that you are a failure or have let yourself or your family down",
        "Trouble concentrating on things, such as reading the newspaper or watching television",
        "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving a lot more than usual",
        "Thoughts that you would be better off dead or of hurting yourself in some way"
    ]

    lines = []
    lines.append('')

    # Client Info
    name = user_meta.get('name') or user_meta.get('userName') or 'Unknown'
    email = user_meta.get('email') or user_meta.get('user_email') or 'Unknown'
    contact = user_meta.get('contact') or user_meta.get('phone') or 'Not available'
    lines.append('## Client Information')
    lines.append(f'- Client name: {name}\n- Email: {email}\n- Contact: {contact}')
    lines.append('')

    # Screening Information – PHQ-9
    lines.append('## Screening Information — PHQ-9 Reports')
    if not phq_entries:
        lines.append('- No PHQ-9 submissions were provided for this student.')
    else:
        # Sort by timestamp if available (most recent first)
        try:
            sorted_phq = sorted(phq_entries, key=lambda p: p.get('timestamp') or p.get('submittedAt') or '', reverse=True)
        except Exception:
            sorted_phq = list(phq_entries)

        # Provide a short summary of the most recent submission
        latest = sorted_phq[0]
        total = latest.get('total_score') or latest.get('totalScore') or latest.get('total') or None
        if total is None and isinstance(latest.get('answers'), list):
            try:
                total = sum(int(x) for x in latest.get('answers'))
            except Exception:
                total = None
        submitted_at = latest.get('timestamp') or latest.get('submittedAt') or 'Unknown'
        score_text = f'Overall PHQ-9 score: {total}' if total is not None else 'Overall PHQ-9 score: Not provided'
        lines.append(f'- {score_text} (most recent submission on {submitted_at}).')

        # Per-question breakdown with full question text for the most recent entry
        answers = latest.get('answers') or latest.get('response') or []
        if isinstance(answers, list) and len(answers) >= 1:
            lines.append('- Per-question responses (most recent submission):')
            for i in range(min(9, len(answers))):
                try:
                    val = int(answers[i])
                except Exception:
                    val = answers[i]
                txt = phq_map.get(val, str(val)) if isinstance(val, int) else str(val)
                qtext = phq_questions[i] if i < len(phq_questions) else f'Q{i+1}'
                lines.append(f'  - {qtext}: {txt}')

        # If multiple entries exist, note trend or stability
        if len(sorted_phq) > 1:
            try:
                recent_scores = []
                for p in sorted_phq[:5]:
                    s = p.get('total_score') or p.get('totalScore')
                    if s is None and isinstance(p.get('answers'), list):
                        try:
                            s = sum(int(x) for x in p.get('answers'))
                        except Exception:
                            s = None
                    recent_scores.append(s)
                numeric = [s for s in recent_scores if isinstance(s, (int, float))]
                if len(numeric) >= 2:
                    delta = numeric[0] - numeric[-1]
                    if abs(delta) >= 5:
                        trend = 'increase' if delta > 0 else 'decrease'
                        lines.append(f'- Notable change detected across recent PHQ-9 submissions: a {trend} of {abs(delta)} points compared to prior entries, which may indicate a meaningful shift in self-reported symptoms.')
                    else:
                        lines.append('- No large recent shifts in PHQ-9 total scores across the most recent submissions; scores appear relatively stable.')
            except Exception:
                pass
    lines.append('')
    lines.append('')

    # PHQ-9: Five-point deterministic summary (long-form bullets)
    try:
        lines.append('### PHQ-9: Five-point summary')
        phq_has_entries = bool(phq_entries)
        # 1) Most recent overall
        if phq_has_entries and latest and total is not None:
            severity_label = 'Unknown'
            try:
                sc = int(total)
                if sc >= 20:
                    severity_label = 'Severe'
                elif sc >= 15:
                    severity_label = 'Moderately severe'
                elif sc >= 10:
                    severity_label = 'Moderate'
                elif sc >= 5:
                    severity_label = 'Mild'
                else:
                    severity_label = 'Minimal'
            except Exception:
                severity_label = 'Unknown'
            lines.append(f'1. Most recent PHQ-9 submission (on {submitted_at}) reports a total score of {total}, which maps to "{severity_label}" severity. This offers a snapshot of current self-reported symptom burden and should guide clinical prioritization.')
        else:
            lines.append('1. No recent PHQ-9 total score available from submissions; consider asking the student to complete a PHQ-9 to obtain a baseline screening score.')

        # If no PHQ entries were supplied at all, provide a short 5-point prompt recommending screening
        if not phq_has_entries:
            lines.append('2. Insufficient longitudinal PHQ-9 data to determine a trend; no submissions were provided.')
            lines.append('3. No per-item responses available to highlight symptom targets.')
            lines.append('4. Data completeness: 0 PHQ-9 submissions; consider administering the PHQ-9 during follow-up.')
            lines.append('5. Recommendation: Invite the student to complete a PHQ-9 screening and document responses before clinical decisions.')
            # Skip the rest of PHQ logic by jumping out of the try block
            raise Exception('no_phq_entries')

        # 2) Trend or stability
        try:
            if len(sorted_phq) > 1 and len(numeric) >= 2:
                delta = numeric[0] - numeric[-1]
                if abs(delta) >= 5:
                    trend_desc = f'There is a {"rise" if delta>0 else "fall"} of {abs(delta)} points across recent entries, a change large enough to warrant closer monitoring or prompt follow-up.'
                else:
                    trend_desc = 'No major change (less than 5 points) across recent PHQ-9 submissions; scores appear relatively stable over the most recent measurements.'
            else:
                trend_desc = 'Insufficient longitudinal PHQ-9 data to determine a trend; fewer than two usable submissions are available.'
            lines.append(f'2. {trend_desc}')
        except Exception:
            lines.append('2. Unable to determine trend from available PHQ-9 entries.')

        # 3) Top symptom areas
        try:
            top_items = []
            if isinstance(answers, list) and any(isinstance(a, (int, float)) for a in answers):
                numeric_answers = [(i, (int(a) if isinstance(a, (int, float)) else (int(a) if str(a).isdigit() else 0))) for i,a in enumerate(answers[:9])]
                numeric_answers.sort(key=lambda x: x[1], reverse=True)
                top_items = [(phq_questions[i], v) for i,v in numeric_answers[:2] if v>0]
            if top_items:
                desc = '; '.join([f'{q} ({v})' for q,v in top_items])
                lines.append(f'3. The most prominent symptom items in the latest submission are: {desc}. These specific items may point to targets for brief interventions or focused questions in the first follow-up session.')
            else:
                lines.append('3. No clear per-question elevations identified in the most recent PHQ-9 submission.')
        except Exception:
            lines.append('3. Unable to compute item-level highlights from PHQ-9 responses.')

        # 4) Data completeness and reliability note
        try:
            count = len(sorted_phq)
            lines.append(f'4. Data completeness: {count} PHQ-9 submission(s) available for review. If the count is low, interpret findings cautiously and consider re-screening or confirming answers during follow-up.')
        except Exception:
            lines.append('4. Data completeness could not be determined from supplied entries.')

        # 5) Actionable recommendation
        try:
            rec = 'Consider standard clinical follow-up: schedule a brief check-in, verify PHQ-9 answers and assess for safety if any suicidal thoughts were reported.'
            if isinstance(total, (int, float)) and total >= 20:
                rec = 'High-priority follow-up recommended due to severe PHQ-9 score; perform immediate risk assessment and consider urgent referral as appropriate.'
            lines.append(f'5. Recommendation: {rec}')
        except Exception:
            lines.append('5. Recommendation: Unable to compute an actionable recommendation from PHQ-9 entries.')
    except Exception:
        lines.append('### PHQ-9: Five-point summary could not be generated due to incomplete data or an internal error.')
    lines.append('')

    # Chatbot History Summary — compute variables, then include only the Five-point deterministic summary
    lines.append('## Chatbot History Summary')
    if not chat_msgs:
        lines.append('- No chatbot conversation history was provided for this student.')
    else:
        # Collect message texts and simple metadata (used by the Five-point summary below)
        texts = [ (m.get('text') or m.get('message') or m.get('content') or '') for m in chat_msgs ]
        joined = ' '.join(texts).lower()

    # Heuristic topic extraction: count presence of topic keywords
        topic_keywords = {
            'stress/anxiety': ['stress','anxiet','panic','nervou'],
            'depression/mood': ['depress','sad','hopeless','hopelessness','low mood'],
            'sleep': ['sleep','insomnia','tired','restless'],
            'relationships': ['relationship','friend','partner','breakup','conflict'],
            'academic/study': ['study','exam','assignment','grades','deadline'],
            'career/work': ['job','career','work','internship']
        }
        topics_found = []
        for topic, keys in topic_keywords.items():
            for k in keys:
                if k in joined:
                    topics_found.append(topic)
                    break
        topics_summary = ', '.join(sorted(set(topics_found))) if topics_found else 'No clear topics identified.'

        # Sentiment/tone heuristic (used in the Five-point summary)
        neg_terms = ['sad','depress','hopeless','suicid','panic','anxious','overwhelmed','stressed','angry']
        pos_terms = ['hope','better','improve','helpful','supported','relieved','okay','coping']
        neg_count = sum(joined.count(t) for t in neg_terms)
        pos_count = sum(joined.count(t) for t in pos_terms)
        tone = 'Neutral' if neg_count == pos_count else ('Negative' if neg_count > pos_count else 'Positive')
        tone_desc = f'{tone} (negative indicators: {neg_count}, positive indicators: {pos_count})'

        # Representative excerpts, sanitized/truncated (optional for item 4)
        sample_excerpt = texts[-4:] if len(texts) >=4 else texts
        cleaned = [s.replace('\n',' ').strip()[:300] for s in sample_excerpt if s]

        # Build a deterministic extractive 500-word summary from the combined chat messages.
        def _summarize_to_n_words(full_text, max_words=500):
            if not full_text or not isinstance(full_text, str):
                return ''
            # Split into sentences (simple rule-based split)
            sentences = re.split(r'(?<=[.!?])\s+', full_text.strip())
            if not sentences:
                return ''

            # Small stopword list for determinism
            stopwords = set(['the','and','is','in','it','of','to','a','i','that','you','for','on','with','this','was','are','be','have','not','as','but','or','they','we','he','she'])

            # build word frequencies
            freqs = {}
            for s in sentences:
                for w in re.findall(r"\w+", s.lower()):
                    if w in stopwords or len(w) <= 2:
                        continue
                    freqs[w] = freqs.get(w, 0) + 1

            # score sentences by sum of word freq
            scored = []
            for idx, s in enumerate(sentences):
                words = re.findall(r"\w+", s.lower())
                score = sum(freqs.get(w, 0) for w in words)
                scored.append((idx, score, s))

            # pick sentences with positive score; deterministic tie-break by original index
            scored_positive = [t for t in scored if t[1] > 0]
            if not scored_positive:
                # fallback: take first sentences until word limit
                out_words = []
                for s in sentences:
                    out_words.extend(re.findall(r"\w+", s))
                    if len(out_words) >= max_words:
                        break
                return ' '.join(out_words[:max_words])

            # choose top sentences by score but limit to those that help reach word count
            scored_positive.sort(key=lambda x: (-x[1], x[0]))
            selected_idxs = [t[0] for t in scored_positive]
            # keep original order for coherence
            selected_idxs = sorted(selected_idxs)

            summary_sentences = []
            total_words = 0
            for idx in selected_idxs:
                s = sentences[idx]
                wcount = len(re.findall(r"\w+", s))
                if total_words + wcount > max_words and total_words > 0:
                    break
                summary_sentences.append(s.strip())
                total_words += wcount
                if total_words >= max_words:
                    break

            # If still too short, append more sentences from start until reaching limit
            si = 0
            while total_words < max_words and si < len(sentences):
                if si not in selected_idxs:
                    s = sentences[si]
                    wcount = len(re.findall(r"\w+", s))
                    if total_words + wcount > max_words:
                        # append truncated
                        words = re.findall(r"\w+", s)[:(max_words - total_words)]
                        if words:
                            summary_sentences.append(' '.join(words))
                        total_words = max_words
                        break
                    summary_sentences.append(s.strip())
                    total_words += wcount
                si += 1

            return ' '.join(summary_sentences)[:max_words*6]  # rough char cap

        joined_full = ' '.join(texts)
        summary_500 = _summarize_to_n_words(joined_full, max_words=500)

        # Chatbot: Five-point deterministic summary only (use 500-word extractive summary split into five long bullets)
        try:
            lines.append('')
            lines.append('### Chatbot History: Five-point summary')
            # Build five long bullets by deterministically splitting the 500-word summary
            try:
                # normalize whitespace
                s = (summary_500 or '').strip()
                if not s:
                    lines.append('1. No substantive chatbot content available to summarize.')
                    lines.append('2. No substantive chatbot content available to summarize.')
                    lines.append('3. No substantive chatbot content available to summarize.')
                    lines.append('4. No substantive chatbot content available to summarize.')
                    lines.append('5. No substantive chatbot content available to summarize.')
                else:
                    # split into words, compute approx chunk sizes
                    words = re.findall(r"\S+", s)
                    total = len(words)
                    # five nearly-equal parts (first parts may be slightly larger to preserve coherence)
                    base = total // 5
                    remainder = total % 5
                    parts = []
                    idx = 0
                    for i in range(5):
                        take = base + (1 if i < remainder else 0)
                        chunk_words = words[idx: idx + take]
                        idx += take
                        parts.append(' '.join(chunk_words))

                    # create long bullet points with context labels
                    labels = ['Topics and concerns', 'Emotional tone and affect', 'Key problem areas and examples', 'Representative excerpts and patterns', 'Recommendations and suggested follow-up']
                    for i in range(5):
                        content = parts[i].strip()
                        # truncate a bit if overly long but keep 'long' bullets
                        if len(content) > 1200:
                            content = content[:1200].rsplit(' ',1)[0] + '...'
                        lines.append(f'{i+1}. {labels[i]}: {content}')
            except Exception:
                lines.append('### Chatbot History: Five-point summary could not be generated due to internal processing error.')
        except Exception:
            lines.append('### Chatbot History: Five-point summary could not be generated due to incomplete data or an internal error.')
    lines.append('')

    # Peer-to-Peer Posts
    lines.append('## Peer-to-Peer Posts')
    if not posts:
        lines.append('- No peer-to-peer posts from this student were provided.')
    else:
        titles = [ (p.get('title') or p.get('subject') or '').strip() for p in posts ]
        bodies = [ (p.get('content') or p.get('body') or '') for p in posts ]
        engaged = len(posts)
        lines.append(f'- The student authored {engaged} community post(s).')
        # Detect helpful / concerning content
        positive = 0
        concerns = 0
        for b in bodies:
            lb = (b or '').lower()
            if any(w in lb for w in ['thank','thanks','helpful','appreciate']):
                positive += 1
            if any(w in lb for w in ['struggling','sad','anxious','help','panic','depress','suicid']):
                concerns += 1
        if positive:
            lines.append(f'- Positive engagement detected in {positive} post(s) where the student expressed appreciation or support.')
        if concerns:
            lines.append(f'- {concerns} post(s) raised concerns or distressing content that may warrant follow-up.')
        preview = '; '.join([t for t in titles[:3] if t])
        if preview:
            lines.append(f'- Sample post topics: {preview}')
        # Peer-to-peer posts: Five-point deterministic summary
        try:
            lines.append('')
            lines.append('### Peer-to-Peer Posts: Five-point summary')
            # 1) Count and engagement
            lines.append(f'1. The student authored {engaged} community post(s); this level of engagement provides insight into their public sharing and community interactions.')
            # 2) Positive vs concerning content
            lines.append(f'2. Content tone: {positive} post(s) with appreciative language and {concerns} post(s) that raised concerns or distressing content; consider prioritizing posts flagged for concern.')
            # 3) Sample topics
            if preview:
                lines.append(f'3. Sample post topics include: {preview}. These topics can help guide contextual follow-up and identify where community support was sought or provided.')
            else:
                lines.append('3. No specific post topics were extractable from provided data.')
            # 4) Behavioral signal
            lines.append('4. Behavioral signal: posting frequency and content type can indicate help-seeking behavior; consider whether posts were calls for assistance versus reflections or updates.')
            # 5) Recommendation
            if concerns:
                lines.append('5. Recommendation: Review and, if necessary, reach out to the student about the concerning posts to assess current mood and needs; escalate to specialist if immediate risk is identified.')
            else:
                lines.append('5. Recommendation: Continue routine monitoring; encourage community supports while offering direct check-ins if other signals (PHQ or chatbot) indicate worsening mood.')
        except Exception:
            lines.append('### Peer-to-Peer Posts: Five-point summary could not be generated due to incomplete data or an internal error.')
    lines.append('')

    # Resource Finder Search History — provide descriptions for searches/accesses
    lines.append('## Resource Finder Search History')
    if not resources:
        lines.append('- No resource access or search history was provided for this student.')
    else:
        # Build descriptive entries for each resource (title, type, language, url)
        lines.append('- Recent resource interactions:')
        for r in (resources or [])[:20]:
            title = r.get('title') or r.get('name') or str(r)
            typ = r.get('type') or r.get('category') or 'other'
            lang = r.get('language') or 'unknown'
            url = r.get('url') or r.get('link') or ''
            desc = f'{title} ({typ}, {lang})'
            if url:
                desc += f' — {url}'
            # If there is evidence of search terms or frequency include it
            freq = r.get('accessCount') or r.get('count') or None
            if freq:
                desc += f' — accessed {freq} time(s)'
            lines.append(f'  - {desc}')
        # Resource Finder: Five-point deterministic summary
        try:
            lines.append('')
            lines.append('### Resource Finder: Five-point summary')
            # 1) Count
            total_res = len(resources or [])
            lines.append(f'1. {total_res} resource interaction(s) recorded, indicating the student''s exploration or use of self-help materials and referrals.')
            # 2) Most accessed or notable resources
            try:
                top_titles = [ (r.get('title') or r.get('name') or '') for r in resources[:5] ]
                if any(top_titles):
                    lines.append(f'2. Notable resources accessed or suggested: {", ".join([t for t in top_titles if t])}.')
                else:
                    lines.append('2. No descriptive titles available for recently accessed resources.')
            except Exception:
                lines.append('2. Unable to list notable resources from provided data.')
            # 3) Resource types and languages
            types = {}
            langs = {}
            try:
                for r in resources or []:
                    typ = r.get('type') or r.get('category') or 'other'
                    lang = r.get('language') or 'unknown'
                    types[typ] = types.get(typ, 0) + 1
                    langs[lang] = langs.get(lang, 0) + 1
                types_desc = ', '.join([f'{k} ({v})' for k,v in sorted(types.items(), key=lambda x:-x[1])]) if types else 'none'
                langs_desc = ', '.join([f'{k} ({v})' for k,v in sorted(langs.items(), key=lambda x:-x[1])]) if langs else 'unknown'
                lines.append(f'3. Resource types and languages encountered: {types_desc}; languages: {langs_desc}.')
            except Exception:
                lines.append('3. Unable to determine resource types or languages from data.')
            # 4) Frequency indicator
            try:
                freq_items = [r for r in resources or [] if (r.get('accessCount') or r.get('count'))]
                if freq_items:
                    topf = freq_items[0]
                    lines.append(f'4. Some resources show repeated access (e.g., "{topf.get("title") or topf.get("name")}" accessed {topf.get("accessCount") or topf.get("count")} times), which may indicate ongoing engagement with that content.')
                else:
                    lines.append('4. No repeated-access indicators found; interactions may be single-event searches or views.')
            except Exception:
                lines.append('4. Unable to compute access frequency from resource records.')
            # 5) Recommendation
            lines.append('5. Recommendation: Use resource interaction data to tailor follow-up suggestions; if specific clinically relevant materials were accessed, incorporate them into the care plan and ask about usefulness during follow-up.')
        except Exception:
            lines.append('### Resource Finder: Five-point summary could not be generated due to incomplete data or an internal error.')
    lines.append('')

    lines.append('Generated for counselor use: concise summary to inform follow-up, triage, or referral decisions.')
    return '\n'.join(lines)


def build_emergency_email(data: dict):
    """Construct subject and body for an emergency notification email.

    Returns (subject: str, body: str).
    This function is best-effort and will include DB-derived context when available.
    """

    detected = data.get('detected') or {}
    user_email = data.get('user_email') or data.get('email') or None
    # user_name may be provided in payloads
    user_name = data.get('user_name') or data.get('userName') or data.get('name') or None
    session_id = data.get('session_id') or data.get('sessionId') or None

    subject_prefix = ''
    danger = None
    if isinstance(detected, dict):
        danger = detected.get('danger_level') or detected.get('dangerLevel')
    if danger:
        subject_prefix = f"[ALERT: {str(danger).upper()}] "

    subject = subject_prefix + "MindSphere - Emergency notification"

    # Build an enriched payload with best-effort DB lookups and safe serialisation
    # Allow the incoming `data` to already include `request_payload`, `latest_phq`, `sessions`, or `session_messages`
    enriched = {'detected': detected}
    # Normalise request payload: prefer nested request_payload when provided
    raw_request = None
    try:
        raw_request = data.get('request_payload') or data.get('requestPayload') or data
    except Exception:
        raw_request = data
    try:
        enriched['request_payload'] = _safe_copy(raw_request)
        # if request payload contains user identifiers, prefer them
        try:
            if not user_email:
                user_email = (raw_request.get('user_email') or raw_request.get('email') or None)
        except Exception:
            pass
        try:
            if not user_name:
                user_name = (raw_request.get('user_name') or raw_request.get('userName') or raw_request.get('name') or None)
        except Exception:
            pass
    except Exception:
        enriched['request_payload'] = raw_request

    # If caller already supplied latest_phq/sessions/session_messages, prefer those over DB lookups
    try:
        if isinstance(data, dict) and data.get('latest_phq'):
            enriched['latest_phq'] = _safe_copy(data.get('latest_phq'))
    except Exception:
        pass
    try:
        if isinstance(data, dict) and data.get('sessions'):
            enriched['sessions'] = _safe_copy(data.get('sessions'))
    except Exception:
        pass
    try:
        if isinstance(data, dict) and data.get('session_messages'):
            enriched['session_messages'] = _safe_copy(data.get('session_messages'))
    except Exception:
        pass

    # If detection details are nested inside request_payload, prefer those
    try:
        if not detected and isinstance(enriched.get('request_payload'), dict):
            detected = enriched['request_payload'].get('detected') or enriched['request_payload'].get('detection') or {}
    except Exception:
        pass

    def _safe_copy(obj):
        """Return a JSON-serialisable copy of obj by converting ObjectIds and datetimes to strings."""
        try:
            # If it's a mapping, copy keys
            if isinstance(obj, dict):
                out = {}
                for k, v in obj.items():
                    out[k] = _safe_copy(v)
                return out
            # If it's a list/tuple, convert elements
            if isinstance(obj, (list, tuple)):
                return [_safe_copy(x) for x in obj]
            # Datetime -> isoformat
            if hasattr(obj, 'isoformat'):
                try:
                    return obj.isoformat()
                except Exception:
                    return str(obj)
            # ObjectId or other -> str
            try:
                import bson
                from bson.objectid import ObjectId
                if isinstance(obj, ObjectId):
                    return str(obj)
            except Exception:
                pass
            # primitives
            return obj
        except Exception:
            try:
                return str(obj)
            except Exception:
                return '<unserializable>'

    # Attach recent PHQ-9 entry for email (best-effort)
    try:
        if 'latest_phq' not in enriched and user_email and hasattr(dbutils, 'find_latest_phq9'):
            latest = dbutils.find_latest_phq9(user_email)
            if latest:
                enriched['latest_phq'] = _safe_copy(latest)
    except Exception:
        pass

    # Attach sessions metadata (best-effort)
    try:
        if 'sessions' not in enriched and user_email and hasattr(dbutils, 'get_sessions_by_email'):
            sessions = dbutils.get_sessions_by_email(user_email)
            if sessions:
                enriched['sessions'] = _safe_copy(sessions)
    except Exception:
        pass

    # Attach recent messages for provided session_id (best-effort)
    try:
        if 'session_messages' not in enriched and session_id and hasattr(dbutils, 'get_session_messages'):
            msgs = dbutils.get_session_messages(user_email, session_id, limit=50, tail=True) or []
            enriched['session_messages'] = _safe_copy(msgs)
    except Exception:
        pass

    # Plain-text body
    lines = []
    lines.append("MindSphere — Emergency notification")
    lines.append("===============================")
    lines.append("")
    lines.append("An emergency/intent-detection event was received by the server.")
    if user_email:
        if user_name:
            lines.append(f"User name: {user_name}")
        lines.append(f"User email: {user_email}")
    if session_id:
        lines.append(f"Session ID: {session_id}")
    lines.append("")
    # Build a human-readable plain-text report summarising key fields
    try:
        lines.append("Detected summary:")
        # Detected info — be tolerant of many shapes and nested structures
        def _find_value(obj, candidates):
            if not isinstance(obj, dict):
                return None
            for c in candidates:
                v = obj.get(c) if c in obj else None
                if v not in (None, ''):
                    return v
            # search one level deep in nested dict values
            for v in obj.values():
                if isinstance(v, dict):
                    for c in candidates:
                        vv = v.get(c) if c in v else None
                        if vv not in (None, ''):
                            return vv
            return None

        if isinstance(detected, dict) or isinstance(detected, str):
            # Intent may be a string or nested in several possible keys
            intent = None
            if isinstance(detected, dict):
                intent = _find_value(detected, ['intent', 'label', 'intent_label', 'predicted_intent', 'prediction', 'label_name'])
            elif isinstance(detected, str) and detected.strip():
                intent = detected.strip()

            # If not found, look inside the request payload common locations
            if not intent and isinstance(enriched.get('request_payload'), dict):
                rp = enriched.get('request_payload')
                intent = _find_value(rp.get('detected') or rp.get('detection') or rp, ['intent', 'label', 'prediction'])

            if not intent:
                intent = 'unknown'

            confidence = _find_value(detected if isinstance(detected, dict) else (enriched.get('request_payload') or {}), ['confidence', 'score', 'probability', 'confidenceScore'])
            danger = _find_value(detected if isinstance(detected, dict) else (enriched.get('request_payload') or {}), ['danger_level', 'dangerLevel', 'danger', 'risk_level', 'riskLevel'])

            lines.append(f"  - Intent: {intent}")
            if confidence is not None:
                try:
                    lines.append(f"  - Confidence: {float(confidence):.2f}")
                except Exception:
                    lines.append(f"  - Confidence: {confidence}")
            if danger:
                lines.append(f"  - Danger level: {danger}")
        else:
            lines.append(f"  - Detected: {str(detected)}")

        # Latest PHQ-9 summary (if available)
        lp = enriched.get('latest_phq')
        if lp:
            try:
                lines.append("")
                lines.append("Latest PHQ-9 entry:")
                # Accept multiple possible score keys and compute from answers when missing
                score = lp.get('total_score') or lp.get('totalScore') or lp.get('score') or lp.get('total') or lp.get('answers_sum')
                answers = lp.get('answers') or lp.get('response') or lp.get('answers_int') or lp.get('answers_ints') or []
                # If score is blank but answers exist, compute total
                try:
                    if (score is None or str(score) == '') and isinstance(answers, (list, tuple)) and answers:
                        score_vals = [int(x) for x in answers if isinstance(x, (int, float)) or (isinstance(x, str) and x.isdigit())]
                        if score_vals:
                            score = sum(score_vals)
                except Exception:
                    pass

                ts = lp.get('timestamp') or lp.get('submittedAt') or ''
                lines.append(f"  - Score: {score if score not in (None, '') else 'N/A'}")
                if ts:
                    lines.append(f"  - Submitted: {ts}")
                # per-question breakdown if present
                if isinstance(answers, (list, tuple)) and len(answers) >= 1:
                    lines.append("  - Answers: " + ', '.join([str(x) for x in answers[:9]]))
            except Exception:
                pass

        # Sessions summary
        sessions = enriched.get('sessions') or []
        ids = []
        try:
            if isinstance(sessions, (list, tuple)) and sessions:
                lines.append("")
                lines.append(f"Sessions: {len(sessions)} found")
                # list up to 5 session ids
                ids = []
                for s in sessions[:5]:
                    sid = s.get('id') or s.get('session_id') or s.get('_id') or str(s)
                    ids.append(str(sid))
                lines.append("  - Recent session IDs: " + ', '.join(ids))
                # Include last message excerpts for each recent session when available
                for s in sessions[:5]:
                    try:
                        lm = s.get('lastMessage') or s.get('last_message') or {}
                        if lm:
                            lmtext = (lm.get('text') or lm.get('message') or '')
                            lmwho = lm.get('from') or lm.get('role') or ''
                            lmts = lm.get('timestamp') or ''
                            excerpt = str(lmtext).replace('\n', ' ')[:300]
                            if lmts:
                                lines.append(f"    - Session {str(sid)} last: [{lmts}] {lmwho}: {excerpt}")
                            else:
                                lines.append(f"    - Session {str(sid)} last: {lmwho}: {excerpt}")
                    except Exception:
                        pass
        except Exception:
            pass

        # Recent messages: include a short excerpt for context
        msgs = enriched.get('session_messages') or []
        try:
            if isinstance(msgs, (list, tuple)) and msgs:
                lines.append("")
                lines.append(f"Recent messages (most recent last, up to 10):")
                for m in (msgs or [])[-10:]:
                    who = m.get('from') or m.get('role') or ''
                    text = m.get('text') or m.get('message') or m.get('content') or ''
                    ts = m.get('timestamp') or ''
                    txt = str(text).replace('\n', ' ')[:300]
                    if ts:
                        lines.append(f"  - [{ts}] {who}: {txt}")
                    else:
                        lines.append(f"  - {who}: {txt}")
        except Exception:
            pass

        # Provide a short list of top-level request payload keys to help triage
        try:
            keys = []
            if isinstance(data, dict):
                keys = [k for k in data.keys() if k not in ('session_messages',)]
            if keys:
                lines.append("")
                lines.append("Request payload keys: " + ', '.join(keys))
        except Exception:
            pass

        # Detailed readable payload section: print every parameter in enriched in a friendly, indented format
        try:
            def _format_plain(obj, indent=0, max_depth=6):
                out = []
                pad = '  ' * indent
                if indent > max_depth:
                    out.append(pad + '...')
                    return out
                if isinstance(obj, dict):
                    for k in sorted(obj.keys()):
                        v = obj.get(k)
                        if isinstance(v, (dict, list, tuple)):
                            out.append(pad + f"{k}:")
                            out.extend(_format_plain(v, indent + 1, max_depth))
                        else:
                            try:
                                out.append(pad + f"{k}: {v}")
                            except Exception:
                                out.append(pad + f"{k}: <unserializable>")
                elif isinstance(obj, (list, tuple)):
                    for i, item in enumerate(obj):
                        if isinstance(item, (dict, list, tuple)):
                            out.append(pad + f"- [{i}]")
                            out.extend(_format_plain(item, indent + 1, max_depth))
                        else:
                            out.append(pad + f"- [{i}] {item}")
                else:
                    out.append(pad + str(obj))
                return out

            lines.append("")
            lines.append("Detailed payload (readable):")
            detail_lines = _format_plain(enriched, indent=0, max_depth=6)
            lines.extend(detail_lines)
            lines.append("")
            lines.append("Full enriched JSON (for debugging):")
        except Exception:
            lines.append("")
            lines.append("Full enriched JSON (for debugging):")
        try:
            json_text = json.dumps(enriched, indent=2, default=str)
        except Exception:
            try:
                json_text = str(enriched)
            except Exception:
                json_text = '<unserializable>'
        lines.append(json_text)
        lines.append("")
        lines.append("-- End of notification --")
    except Exception:
        # Fallback to raw JSON if anything goes wrong building the report
        try:
            json_text = json.dumps(enriched, indent=2, default=str)
        except Exception:
            try:
                json_text = str(enriched)
            except Exception:
                json_text = '<unserializable>'
        lines = ["MindSphere — Emergency notification", "===============================", "", json_text, "", "-- End of notification --"]

    plain_body = "\n".join(lines)

    # Build a simple HTML report version (human-readable sections)
    try:
        parts = []
        parts.append('<html>')
        parts.append('<body style="font-family: system-ui, -apple-system, \"Segoe UI\", Roboto, \"Helvetica Neue\", Arial; color:#111;">')
        parts.append('<h2 style="color:#c33;">MindSphere — Emergency notification</h2>')
        parts.append('<p>An emergency/intent-detection event was received by the server.</p>')
        if user_email:
            if user_name:
                parts.append(f'<p><strong>User name:</strong> {html.escape(str(user_name))}</p>')
            parts.append(f'<p><strong>User email:</strong> {html.escape(str(user_email))}</p>')
        if session_id:
            parts.append(f'<p><strong>Session ID:</strong> {html.escape(str(session_id))}</p>')

        # Detected summary
        parts.append('<h3>Detected</h3>')
        try:
            # reuse tolerant extraction logic from plain text
            def _find_value_html(obj, candidates):
                if not isinstance(obj, dict):
                    return None
                for c in candidates:
                    v = obj.get(c) if c in obj else None
                    if v not in (None, ''):
                        return v
                for v in obj.values():
                    if isinstance(v, dict):
                        for c in candidates:
                            vv = v.get(c) if c in v else None
                            if vv not in (None, ''):
                                return vv
                return None

            if isinstance(detected, dict) or isinstance(detected, str):
                intent_val = None
                if isinstance(detected, dict):
                    intent_val = _find_value_html(detected, ['intent', 'label', 'intent_label', 'predicted_intent', 'prediction', 'label_name'])
                elif isinstance(detected, str) and detected.strip():
                    intent_val = detected.strip()
                if not intent_val and isinstance(enriched.get('request_payload'), dict):
                    rp = enriched.get('request_payload')
                    intent_val = _find_value_html(rp.get('detected') or rp.get('detection') or rp, ['intent', 'label', 'prediction'])
                if not intent_val:
                    intent_val = 'unknown'

                confidence_val = _find_value_html(detected if isinstance(detected, dict) else (enriched.get('request_payload') or {}), ['confidence', 'score', 'probability', 'confidenceScore'])
                danger_val = _find_value_html(detected if isinstance(detected, dict) else (enriched.get('request_payload') or {}), ['danger_level', 'dangerLevel', 'danger', 'risk_level', 'riskLevel'])

                intent = html.escape(str(intent_val))
                danger = html.escape(str(danger_val)) if danger_val not in (None, '') else ''
                parts.append('<ul>')
                parts.append(f'<li><strong>Intent:</strong> {intent}</li>')
                if confidence_val is not None:
                    try:
                        parts.append(f'<li><strong>Confidence:</strong> {float(confidence_val):.2f}</li>')
                    except Exception:
                        parts.append(f'<li><strong>Confidence:</strong> {html.escape(str(confidence_val))}</li>')
                if danger:
                    parts.append(f'<li><strong>Danger level:</strong> {danger}</li>')
                parts.append('</ul>')
            else:
                parts.append(f'<p>{html.escape(str(detected))}</p>')
        except Exception:
            parts.append('<p>Could not summarise detected payload.</p>')

        # PHQ-9
        if lp:
            parts.append('<h3>Latest PHQ-9</h3>')
            try:
                # mirror plain-text logic for score and answers
                score = lp.get('total_score') or lp.get('totalScore') or lp.get('score') or lp.get('total') or lp.get('answers_sum')
                answers = lp.get('answers') or lp.get('response') or lp.get('answers_int') or lp.get('answers_ints') or []
                try:
                    if (score is None or str(score) == '') and isinstance(answers, (list, tuple)) and answers:
                        score_vals = [int(x) for x in answers if isinstance(x, (int, float)) or (isinstance(x, str) and x.isdigit())]
                        if score_vals:
                            score = sum(score_vals)
                except Exception:
                    pass

                parts.append('<ul>')
                parts.append(f"<li><strong>Score:</strong> {html.escape(str(score if score not in (None, '') else 'N/A'))}</li>")
                if lp.get('timestamp'):
                    parts.append(f"<li><strong>Submitted:</strong> {html.escape(str(lp.get('timestamp')))}</li>")
                if isinstance(answers, (list, tuple)) and answers:
                    parts.append(f"<li><strong>Answers:</strong> {html.escape(', '.join([str(x) for x in answers[:9]]))}</li>")
                parts.append('</ul>')
            except Exception:
                parts.append('<p>Could not render PHQ-9 details.</p>')

        # Sessions
        try:
            if isinstance(sessions, (list, tuple)) and sessions:
                parts.append('<h3>Sessions</h3>')
                parts.append(f'<p>{len(sessions)} session(s) found. Recent IDs: ' + html.escape(', '.join(ids)) + '</p>')
                # include last message excerpts for the recent sessions
                parts.append('<ul>')
                for s in sessions[:5]:
                    try:
                        sid = s.get('id') or s.get('session_id') or s.get('_id') or str(s)
                        lm = s.get('lastMessage') or s.get('last_message') or {}
                        if lm:
                            lmtext = html.escape(str(lm.get('text') or lm.get('message') or ''))
                            lmwho = html.escape(str(lm.get('from') or lm.get('role') or ''))
                            lmts = html.escape(str(lm.get('timestamp') or ''))
                            if lmts:
                                parts.append(f'<li><strong>Session {html.escape(str(sid))} last:</strong> [{lmts}] {lmwho}: {lmtext}</li>')
                            else:
                                parts.append(f'<li><strong>Session {html.escape(str(sid))} last:</strong> {lmwho}: {lmtext}</li>')
                    except Exception:
                        pass
                parts.append('</ul>')
        except Exception:
            pass

        # Recent messages
        try:
            if isinstance(msgs, (list, tuple)) and msgs:
                parts.append('<h3>Recent messages</h3>')
                parts.append('<div style="background:#f6f8fa;border:1px solid #e1e4e8;padding:12px;border-radius:6px;">')
                for m in (msgs or [])[-10:]:
                    who = html.escape(str(m.get('from') or m.get('role') or ''))
                    text = html.escape(str(m.get('text') or m.get('message') or m.get('content') or ''))
                    ts = html.escape(str(m.get('timestamp') or ''))
                    if ts:
                        parts.append(f'<p><strong>[{ts}] {who}:</strong> {text}</p>')
                    else:
                        parts.append(f'<p><strong>{who}:</strong> {text}</p>')
                parts.append('</div>')
        except Exception:
            pass

        # Full JSON for debugging (escaped)
        # Detailed readable payload (HTML): expand every key/value in enriched in a friendly tree
        parts.append('<h3>Detailed payload (readable)</h3>')
        try:
            def _format_html(obj):
                # returns an HTML fragment (ul/li) for the object
                if isinstance(obj, dict):
                    parts_html = ['<ul style="margin:6px 0 6px 12px;">']
                    for k in sorted(obj.keys()):
                        v = obj.get(k)
                        if isinstance(v, (dict, list, tuple)):
                            parts_html.append(f'<li><strong>{html.escape(str(k))}:</strong> ' + _format_html(v) + '</li>')
                        else:
                            parts_html.append(f'<li><strong>{html.escape(str(k))}:</strong> {html.escape(str(v))}</li>')
                    parts_html.append('</ul>')
                    return '\n'.join(parts_html)
                elif isinstance(obj, (list, tuple)):
                    parts_html = ['<ul style="margin:6px 0 6px 12px;">']
                    for i, item in enumerate(obj):
                        if isinstance(item, (dict, list, tuple)):
                            parts_html.append(f'<li><strong>[{i}]</strong> ' + _format_html(item) + '</li>')
                        else:
                            parts_html.append(f'<li><strong>[{i}]</strong> {html.escape(str(item))}</li>')
                    parts_html.append('</ul>')
                    return '\n'.join(parts_html)
                else:
                    return html.escape(str(obj))

            parts.append(_format_html(enriched))
        except Exception:
            parts.append('<p>Could not render detailed payload.</p>')

        parts.append('<h3>Full enriched JSON (debug)</h3>')
        try:
            parts.append('<pre style="background:#fff;border:1px solid #eee;padding:12px;border-radius:6px;white-space:pre-wrap;">')
            parts.append(html.escape(json_text))
            parts.append('</pre>')
        except Exception:
            parts.append('<p>Could not include full JSON.</p>')

        parts.append('<p style="color:#666;font-size:12px;margin-top:12px;">This is an automated alert from MindSphere.</p>')
        parts.append('</body>')
        parts.append('</html>')
        html_body = '\n'.join(parts)
    except Exception:
        # Fallback to simple escaped JSON view
        try:
            pretty_json = html.escape(json.dumps(enriched, indent=2, default=str))
        except Exception:
            pretty_json = html.escape(str(enriched))
        html_body = f"""
        <html>
          <body>
            <pre>{pretty_json}</pre>
          </body>
        </html>
        """

    return subject, plain_body, html_body
