const path = require('path');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegPath = require('ffmpeg-static');
ffmpeg.setFfmpegPath(ffmpegPath);

const log = (...args) => console.log(`[${new Date().toTimeString().slice(0, 8)}]`, ...args);

function isWavFile(inputPath) {
  try {
    const buf = Buffer.alloc(12);
    const fd = fs.openSync(inputPath, 'r');
    fs.readSync(fd, buf, 0, 12, 0);
    fs.closeSync(fd);
    return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
  } catch (_) {
    return false;
  }
}

function convertToWav(inputPath) {
  const stat = fs.statSync(inputPath);
  log(`convertToWav: input=${path.basename(inputPath)}, size=${stat.size} bytes`);

  if (isWavFile(inputPath)) {
    log('convertToWav: input is already WAV — skipping FFmpeg');
    return Promise.resolve(inputPath);
  }

  return new Promise((resolve, reject) => {
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(dir, `${base}-out.wav`);

    log(`convertToWav: running FFmpeg ${path.extname(inputPath)} → .wav`);

    ffmpeg(inputPath)
      .audioFrequency(16000)
      .audioChannels(1)
      .format('wav')
      .on('error', (err) => {
        log(`convertToWav: FFmpeg FAILED — ${err.message}`);
        reject(new Error(`FFmpeg conversion failed: ${err.message}`));
      })
      .on('end', () => {
        const outStat = fs.statSync(outputPath);
        log(`convertToWav: FFmpeg done, output=${outStat.size} bytes`);
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

module.exports = { convertToWav };
