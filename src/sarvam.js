const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

const STT_URL = 'https://api.sarvam.ai/speech-to-text';
const TTS_URL = 'https://api.sarvam.ai/text-to-speech';

function mapLanguage(language) {
  switch (language) {
    case 'hinglish':
    case 'hi-IN':
      return 'hi-IN';
    case 'en-IN':
      return 'en-IN';
    default:
      return 'hi-IN';
  }
}

const log = (...args) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...args);

async function transcribeAudio(wavFilePath, language, hints) {
  const form = new FormData();
  form.append('file', fs.createReadStream(wavFilePath), {
    filename: 'audio.wav',
    contentType: 'audio/wav',
  });
  form.append('language_code', mapLanguage(language));

  if (Array.isArray(hints) && hints.length > 0) {
    form.append('hints', JSON.stringify(hints));
  }

  const response = await axios.post(STT_URL, form, {
    headers: {
      ...form.getHeaders(),
      'api-subscription-key': process.env.SARVAM_API_KEY,
      Authorization: `Bearer ${process.env.SARVAM_API_KEY}`,
    },
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 30000,
  });

  const data = response.data || {};
  return data.transcript || data.text || '';
}

async function textToSpeech(text, language) {
  try {
    const response = await axios.post(
      TTS_URL,
      {
        inputs: [text],
        target_language_code: mapLanguage(language),
        speaker: 'meera',
        model: 'bulbul:v1',
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'api-subscription-key': process.env.SARVAM_API_KEY,
          Authorization: `Bearer ${process.env.SARVAM_API_KEY}`,
        },
        timeout: 30000,
      }
    );

    const data = response.data || {};
    if (data.audio_url) return data.audio_url;
    if (Array.isArray(data.audios) && data.audios.length > 0) return data.audios[0];
    return null;
  } catch (err) {
    log('TTS error (non-fatal):', err.message);
    return null;
  }
}

module.exports = { transcribeAudio, textToSpeech, mapLanguage };
