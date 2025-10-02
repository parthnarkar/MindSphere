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

# reuse model response extraction utilities
from .model import _extract_text, _coerce_to_string
from . import model as modelutils
# --- Configuration ---
from difflib import SequenceMatcher
try:
    import google.generativeai as genai
except Exception:
    genai = None


GEMINI_API_KEY = os.getenv('GEMINI_API_KEY')
GEMINI_MODEL = os.getenv('MODEL_NAME')


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

        # Recovery: ask the model again with an explicit 'ONLY JSON' instruction
        try:
            recovery_prompt = (
                UNIFIED_INTENT_PROMPT + " " + message + "\n\n"
                "IMPORTANT: If your previous output was not valid JSON, respond now with ONLY a valid JSON object exactly matching the schema and nothing else."
            )
            raw2 = _call_gemini(recovery_prompt)
            if raw2 and isinstance(raw2, str) and raw2.strip():
                try:
                    parsed = _parse_json_strict(raw2)
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
                    try:
                        dl = (result.get('danger_level') or 'low').lower()
                        it = (result.get('intent') or '').lower()
                        result['unsafe'] = dl in ('moderate', 'high') or it == 'crisis'
                        result['safe'] = not result['unsafe']
                    except Exception:
                        result['unsafe'] = False
                        result['safe'] = True
                    if result['danger_level'].lower() == 'high':
                        md = result.get('metadata') or {}
                        md['escalation_required'] = True
                        md['escalation_note'] = 'High danger detected; escalate externally'
                        result['metadata'] = md
                    # annotate that recovery succeeded
                    result['metadata'] = result.get('metadata') or {}
                    result['metadata']['recovery'] = 'second_pass_success'
                    return result
                except Exception as e2:
                    meta['error_second_parse'] = str(e2)
                    if isinstance(raw2, str) and raw2.strip():
                        meta['model_raw_snippet_second'] = raw2.strip()[:2000]
        except Exception as e2:
            meta['error_second_call'] = str(e2)

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
            rec = 'Consider standard clinical follow-up: schedule a brief check-in, verify PHQ-9 answers, and assess for safety if any suicidal thoughts were reported.'
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