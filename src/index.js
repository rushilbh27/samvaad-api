require('dotenv').config();

const fs = require('fs');
const path = require('path');
const os = require('os');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const { convertToWav } = require('./convert');
const { transcribeAudio, textToSpeech } = require('./sarvam');
const { extractIntent } = require('./intent');

const PORT = process.env.PORT || 3000;
const log = (...args) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...args);
const errLog = (...args) => console.error(`[${new Date().toTimeString().slice(0, 8)}] ERROR:`, ...args);

const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)
    : null;

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, os.tmpdir()),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '';
      cb(null, `samvaad-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function safeUnlink(p) {
  if (!p) return;
  fs.unlink(p, () => {});
}

function logToSupabase(row) {
  if (!supabase) return;
  supabase
    .from('samvaad_requests')
    .insert(row)
    .then(({ error }) => {
      if (error) errLog('Supabase insert failed:', error.message);
    })
    .catch((e) => errLog('Supabase insert threw:', e.message));
}

function buildConfirmation(intentResult) {
  if (!intentResult || !intentResult.intent) return null;
  return `Got it. ${intentResult.intent.replace(/_/g, ' ')} recorded.`;
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/process', upload.single('audio'), async (req, res) => {
  const startTime = Date.now();
  let uploadPath = req.file ? req.file.path : null;
  let wavPath = null;
  let transcript = '';
  let language = req.body && req.body.language ? req.body.language : 'hinglish';
  let intentResult = null;
  let success = false;
  let errorMessage = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Audio file is required', code: 'MISSING_AUDIO' });
    }

    log(`POST /process — file: ${req.file.originalname}, size: ${req.file.size} bytes, mime: ${req.file.mimetype}`);

    if (!req.body || !req.body.schema) {
      return res.status(400).json({ error: 'Schema is required', code: 'MISSING_SCHEMA' });
    }

    let schema;
    try {
      schema = JSON.parse(req.body.schema);
    } catch (_) {
      return res.status(400).json({ error: 'Schema must be valid JSON', code: 'INVALID_SCHEMA_JSON' });
    }
    if (!Array.isArray(schema)) {
      return res.status(400).json({ error: 'Schema must be an array of intents', code: 'INVALID_SCHEMA_SHAPE' });
    }

    let hints = [];
    if (req.body.context) {
      try {
        const parsedCtx = JSON.parse(req.body.context);
        if (Array.isArray(parsedCtx)) hints = parsedCtx;
      } catch (_) {}
    }

    log('Step 1/3: Converting audio…');
    try {
      wavPath = await convertToWav(uploadPath);
    } catch (err) {
      errLog('Audio conversion failed:', err.message);
      return res.status(400).json({
        error: `Audio conversion failed: ${err.message}`,
        code: 'CONVERSION_FAILED',
      });
    }
    log('Step 1/3: ✓ Audio ready');

    log('Step 2/3: Transcribing via Sarvam…');
    transcript = await transcribeAudio(wavPath, language, hints);
    log(`Step 2/3: ✓ Transcript: "${transcript}"`);

    if (!transcript || !transcript.trim()) {
      const intentNames = schema.map((s) => s && s.name).filter(Boolean);
      const response = {
        intent: null,
        confidence: 0,
        rawTranscript: '',
        suggestions: intentNames,
        message: 'No speech detected',
      };
      logToSupabase({
        transcript: '',
        intent: null,
        confidence: 0,
        language,
        success: false,
        error: null,
        duration_ms: Date.now() - startTime,
      });
      return res.json(response);
    }

    log('Step 3/3: Extracting intent via Claude Haiku…');
    intentResult = await extractIntent(transcript, schema, language);
    log(`Step 3/3: ✓ Intent: ${intentResult.intent} (confidence: ${intentResult.confidence})`);

    let ttsUrl = null;
    if (intentResult.intent && intentResult.confidence >= 0.6) {
      const confirmation = buildConfirmation(intentResult);
      if (confirmation) {
        ttsUrl = await textToSpeech(confirmation, language);
      }
    }

    const intentNames = schema.map((s) => s && s.name).filter(Boolean);
    const responseBody =
      intentResult.intent && intentResult.confidence >= 0.6
        ? {
            intent: intentResult.intent,
            params: intentResult.params || {},
            confidence: intentResult.confidence,
            rawTranscript: transcript,
            ttsUrl,
          }
        : {
            intent: null,
            confidence: 0,
            rawTranscript: transcript,
            suggestions: intentNames,
          };

    success = !!(intentResult.intent && intentResult.confidence >= 0.6);

    logToSupabase({
      transcript,
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      language,
      success,
      error: null,
      duration_ms: Date.now() - startTime,
    });

    return res.json(responseBody);
  } catch (err) {
    errorMessage = err && err.message ? err.message : String(err);
    errLog(errorMessage);
    logToSupabase({
      transcript,
      intent: intentResult ? intentResult.intent : null,
      confidence: intentResult ? intentResult.confidence : 0,
      language,
      success: false,
      error: errorMessage,
      duration_ms: Date.now() - startTime,
    });
    return res.status(500).json({ error: errorMessage, code: 'INTERNAL_ERROR' });
  } finally {
    safeUnlink(uploadPath);
    safeUnlink(wavPath);
  }
});

app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'Audio file exceeds 10MB limit', code: 'FILE_TOO_LARGE' });
  }
  errLog(err && err.message ? err.message : err);
  return res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
});

process.on('uncaughtException', (err) => errLog('uncaughtException:', err.message));
process.on('unhandledRejection', (err) => errLog('unhandledRejection:', err && err.message ? err.message : err));

app.listen(PORT, () => {
  log(`samvaad-api listening on port ${PORT}`);
});
