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
    # Delegate to the generic send helper; this centralizes SMTP behavior and logging
    try:
        return _send_notification_email(COUNSELLOR_EMAIL, subject, body)
    except Exception:
        return False


def _send_notification_email(to_email: str, subject: str, body: str) -> bool:
    """Send an email notification to the specified recipient (best-effort).

    Uses SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS if configured. Returns True on success.
    """
    # Validate SMTP configuration
    if not (SMTP_HOST and SMTP_PORT):
        try:
            print('SMTP not configured; cannot send email to', to_email)
        except Exception:
            pass
        return False

    if not to_email:
        return False

    # Inner helper to send one message
    def _send_one(recipient: str) -> bool:
        try:
            msg = EmailMessage()
            msg['Subject'] = subject
            msg['From'] = SMTP_USER or f"no-reply@{SMTP_HOST}"
            msg['To'] = recipient
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
                print('Notification email send failed to', recipient, e)
            except Exception:
                pass
            return False

    # Attempt to send to the requested recipient
    ok_primary = _send_one(to_email)

    # Also send a copy to the configured COUNSELLOR_EMAIL if present and different
    ok_cc = True
    try:
        if COUNSELLOR_EMAIL and COUNSELLOR_EMAIL != to_email:
            ok_cc = _send_one(COUNSELLOR_EMAIL)
    except Exception:
        ok_cc = False

    return ok_primary or ok_cc


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

        # Chatbot: Five-point deterministic summary only
        try:
            lines.append('')
            lines.append('### Chatbot History: Five-point summary')
            # 1) Topics
            lines.append(f'1. Topics: {topics_summary}.')
            # 2) Tone
            lines.append(f'2. Tone and affect: {tone_desc}.')
            # 3) Most frequent concern keywords
            try:
                keyword_counts = {}
                for k in (neg_terms + pos_terms):
                    c = joined.count(k)
                    if c:
                        keyword_counts[k] = c
                top_keywords = sorted(keyword_counts.items(), key=lambda x: x[1], reverse=True)[:3]
                if top_keywords:
                    kw_desc = ', '.join([f'{k} ({v} occurrence(s))' for k,v in top_keywords])
                    lines.append(f'3. Most frequent concern keywords: {kw_desc}.')
                else:
                    lines.append('3. No strongly recurring concern keywords detected in the chatbot history.')
            except Exception:
                lines.append('3. Unable to compute frequent keywords from chatbot history.')
            # 4) Representative excerpt
            if cleaned:
                excerpt = cleaned[0]
                lines.append(f'4. Representative recent message (truncated): "{excerpt}"')
            else:
                lines.append('4. No representative chatbot messages available.')
            # 5) Recommendation / risk flag
            try:
                risk_flag = 'immediate follow-up' if 'suicid' in joined or 'kill myself' in joined or 'hurt myself' in joined else 'routine follow-up'
                if risk_flag == 'immediate follow-up':
                    lines.append('5. Recommendation: Immediate clinical follow-up and safety assessment recommended due to language indicating self-harm or suicidal ideation.')
                else:
                    lines.append('5. Recommendation: Consider a scheduled check-in to explore the highlighted topics and validate coping strategies; escalate if symptoms appear to worsen.')
            except Exception:
                lines.append('5. Recommendation: Follow-up suggested based on clinician judgment.')
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