const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are an intent extraction engine for Samvaad, a voice interface SDK.
Your only job is to map a spoken transcript to the closest intent in the provided schema.

Rules:
- Return ONLY a valid JSON object. No text before or after. No markdown code blocks.
- Map the transcript to exactly one intent from the schema, or return null if nothing fits.
- Extract all params described in the schema from the transcript.
- If a param is unclear or not mentioned, set it to null. Never guess or invent values.
- Items arrays: each element must have "product" (product name string) and "qty" (integer). Example: [{"product":"Maggi","qty":5},{"product":"chai","qty":3}]
- Convert relative dates (kal, aaj, tomorrow, parso, shukravar, Friday) to YYYY-MM-DD format. Today is {TODAY}.
- Confidence score: 1.0 = perfect match, 0.0 = no match. Be honest.
- This transcript may be Hinglish (Hindi + English mixed). That is normal and expected.
- Quantities may be spoken as Hindi numbers (pachas=50, bees=20, das=10, sau=100).
- If intent is null, still return rawTranscript and set confidence to 0.

Payment term mapping (always normalise to one of: "cash", "credit", "pending"):
- cash / nakit / naqd / abhi / turant → "cash"
- credit / udhaar / baad mein / udhar / karza / khata mein → "credit"
- pending / baad → "pending"
If no payment term is mentioned, set payment to null.

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
