const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an intent extraction engine for Samvaad, a voice interface SDK.
Your only job is to map a spoken transcript to the closest intent in the provided schema.

Rules:
- Return ONLY a valid JSON object. No text before or after. No markdown code blocks.
- Map the transcript to exactly one intent from the schema, or return null if nothing fits.
- Extract ALL params described in the schema from the transcript. Be aggressive — if a word could be a shop name, product name, or quantity, extract it.
- If a param is unclear or not mentioned, set it to null. Never guess or invent values.
- Items arrays: each element must have "product" (product name string) and "qty" (integer). Example: [{"product":"Maggi","qty":5},{"product":"chai","qty":3}]
- Quantity hints: "packets", "pieces", "boxes", "kg", "packet" after a number means that number is the qty for the preceding or following product.
- Convert relative dates (kal, aaj, tomorrow, shukravar, Friday) to YYYY-MM-DD format. Today is {TODAY}.
- Confidence score: 1.0 = perfect match, 0.0 = no match. Be generous — if the user clearly wants to do something that maps to an intent, give 0.85+. Only give low confidence if the transcript is genuinely ambiguous or doesn't match ANY intent.
- This transcript may be Hinglish (Hindi + English mixed). That is normal and expected.
- STT transcripts are often messy — words may be misspelled, run together, or in unexpected order. Try hard to extract meaning.
- If intent is null, still return the full JSON with confidence 0.

Payment term mapping (always normalise to one of: "cash", "credit", "pending"):
- cash / nakit / naqd / abhi / turant / "payment cash" → "cash"
- credit / udhaar / baad mein / udhar / karza / khata mein / "udhar" → "credit"
- pending / baad → "pending"
If no payment term is mentioned, set payment to null.

Examples of transcripts and expected extractions:
- "50 maggi packets singh brothers payment cash" → log_order, shop_name="singh brothers", items=[{"product":"maggi","qty":50}], payment="cash", confidence=0.95
- "sharma traders mein 5 parle g aur 3 maggi" → log_order, shop_name="sharma traders", items=[{"product":"parle g","qty":5},{"product":"maggi","qty":3}], payment=null, confidence=0.9
- "open patel kirana" → open_shop, shop_name="patel kirana", confidence=0.95
- "singh brothers visit done" → mark_visit, shop_name="singh brothers", outcome="no_order", confidence=0.9

Return format:
{
  "intent": "intent_name_or_null",
  "params": { },
  "confidence": 0.0
}`;

function safeParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = text && text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (_) {
        return null;
      }
    }
    return null;
  }
}

async function extractIntent(transcript, schema, language) {
  const today = new Date().toISOString().split('T')[0];
  const system = SYSTEM_PROMPT.replace('{TODAY}', today);

  const userMessage = `Schema:\n${JSON.stringify(schema, null, 2)}\n\nTranscript:\n"${transcript}"\n\nLanguage: ${language}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  const parsed = safeParseJson(text);
  if (!parsed || typeof parsed !== 'object') {
    return { intent: null, params: {}, confidence: 0 };
  }

  const validNames = Array.isArray(schema) ? schema.map((s) => s && s.name).filter(Boolean) : [];
  if (parsed.intent && !validNames.includes(parsed.intent)) {
    return { intent: null, params: {}, confidence: 0 };
  }

  return {
    intent: parsed.intent || null,
    params: parsed.params || {},
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0,
  };
}

module.exports = { extractIntent };
