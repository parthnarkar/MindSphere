import os

try:
    import google.generativeai as genai
except Exception:
    genai = None

# We'll store a lightweight client configuration: model_name if configured, and a reference to genai
model_name = None
client = None


def init_model():
    """Initialize the generative AI client if available.

    Configurable via environment variables:
      GEMINI_API_KEY - API key for Google Generative AI
    """
    global model_name, client
    if genai is None:
        client = None
        model_name = None
        return

    api_key = os.getenv('GEMINI_API_KEY')
    if not api_key:
        # No key configured -> disable client
        client = None
        model_name = None
        return

    try:
        genai.configure(api_key=api_key)
        client = genai
        model_name = os.getenv('MODEL_NAME')
    except Exception as e:
        print('Failed to initialize Gemini client:', e)
        client = None
        model_name = None


def _extract_text(resp):
    """Try multiple patterns to extract text content from a model response."""
    try:
        # If it's a mapping-like response
        if isinstance(resp, dict):
            # common patterns
            if 'candidates' in resp and resp['candidates']:
                c = resp['candidates'][0]
                if isinstance(c, dict) and 'content' in c:
                    return c['content']
            if 'output' in resp and resp['output']:
                o = resp['output'][0]
                if isinstance(o, dict) and 'content' in o:
                    return o['content']
            if 'text' in resp:
                return resp['text']

        # Object with attributes (older SDK objects)
        if hasattr(resp, 'candidates') and getattr(resp, 'candidates'):
            try:
                return getattr(resp.candidates[0], 'content', str(resp.candidates[0]))
            except Exception:
                pass
        if hasattr(resp, 'output') and getattr(resp, 'output'):
            try:
                return getattr(resp.output[0], 'content', str(resp.output[0]))
            except Exception:
                pass
        if hasattr(resp, 'text'):
            return getattr(resp, 'text')
    except Exception:
        pass
    try:
        return str(resp)
    except Exception:
        return None


def _coerce_to_string(x):
    """Ensure the returned value is a plain Python string.

    The generative SDK may return nested objects (Content, Text, etc.).
    Recursively pull .text or .content attributes if present, otherwise fall back to str().
    """
    try:
        if x is None:
            return None
        if isinstance(x, str):
            return x
        # If it's bytes, decode
        if isinstance(x, (bytes, bytearray)):
            try:
                return x.decode('utf-8')
            except Exception:
                return str(x)
        # Recursively unwrap common fields
        if hasattr(x, 'text'):
            return _coerce_to_string(getattr(x, 'text'))
        if hasattr(x, 'content'):
            return _coerce_to_string(getattr(x, 'content'))
        # If it's an iterable with a single string-like element, try that
        try:
            # avoid treating strings as iterables here
            if not isinstance(x, (str, bytes, bytearray)):
                iter(x)
                # pick first element if it exists
                first = None
                for first in x:
                    break
                if first is not None:
                    return _coerce_to_string(first)
        except Exception:
            pass
        return str(x)
    except Exception:
        try:
            return str(x)
        except Exception:
            return None


def _clean_text(s: str):
    """Return the raw text content from various SDK string representations.

    This removes proto-style wrappers (e.g., `parts { text: "..." } role: "model"`)
    and returns the inner user-facing text. If nothing matched, returns the
    original string stripped.
    """
    try:
        if s is None:
            return None
        import re
        # Try to extract text from a `parts { text: "..." }` representation
        m = re.search(r'parts\s*\{.*?text:\s*"(.*?)".*?\}', s, re.DOTALL)
        if m:
            return m.group(1).strip()
        # Remove any lines like: role: "model"
        s2 = re.sub(r'\n?role:\s*".*?"\n?', '\n', s)
        # Remove extraneous braces or leading/trailing whitespace
        s2 = s2.strip()
        return s2
    except Exception:
        try:
            return s.strip()
        except Exception:
            return s


def generate_coping_text(prompt: str):
    """Generate coping text using the configured Gemini client. Returns None on failure.

    The function attempts multiple client call styles to be compatible with different
    versions of the google.generativeai package. If no client/key is configured, it
    returns None so callers can fall back to canned text.
    """
    if client is None or not model_name:
        # Force caller to handle missing configuration explicitly
        raise RuntimeError('Gemini client not configured. Set GEMINI_API_KEY and GEMINI_MODEL if required.')

    # Attempt generation and raise on failures so callers don't silently fallback
    # Preferred newer API: genai.generate(model=..., input=...)
    if hasattr(client, 'generate'):
        resp = client.generate(model=model_name, input=prompt)
        text = _extract_text(resp)
        text = _coerce_to_string(text)
        text = _clean_text(text)
        if text is None:
            raise RuntimeError('Model returned no text')
        return text

    # Alternate API: genai.generate_text
    if hasattr(client, 'generate_text'):
        resp = client.generate_text(model=model_name, text=prompt)
        text = _extract_text(resp)
        text = _coerce_to_string(text)
        text = _clean_text(text)
        if text is None:
            raise RuntimeError('Model returned no text')
        return text

    # Older SDK object usage: construct a GenerativeModel if available
    if hasattr(client, 'GenerativeModel'):
        gm = client.GenerativeModel(model_name)
        if hasattr(gm, 'generate_content'):
            out = gm.generate_content(prompt)
            text = _extract_text(out)
            text = _coerce_to_string(text)
            text = _clean_text(text)
            if text is None:
                raise RuntimeError('Model returned no text')
            return text
        if hasattr(gm, 'generate'):
            out = gm.generate(prompt)
            text = _extract_text(out)
            text = _coerce_to_string(text)
            text = _clean_text(text)
            if text is None:
                raise RuntimeError('Model returned no text')
            return text

    raise RuntimeError('No supported generation method available on google.generativeai client')
