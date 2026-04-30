const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

function convertToWav(inputPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(inputPath);
    const base = path.basename(inputPath, path.extname(inputPath));
    const outputPath = path.join(dir, `${base}-out.wav`);

    ffmpeg(inputPath)
      .audioFrequency(16000)
      .audioChannels(1)
      .format('wav')
      .on('error', (err) => {
        reject(new Error(`FFmpeg conversion failed: ${err.message}`));
      })
      .on('end', () => {
        resolve(outputPath);
      })
      .save(outputPath);
  });
}

module.exports = { convertToWav };
