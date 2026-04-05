// Audio utilities: WAV encoding, Float32Array slicing

/**
 * Encode a Float32Array (mono, 16kHz) as a WAV ArrayBuffer
 */
export function encodeWAV(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);        // PCM
  view.setUint16(22, 1, true);        // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  // Convert float32 → int16
  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

/**
 * Slice a Float32Array audio buffer between start/end seconds
 */
export function sliceAudio(
  samples: Float32Array,
  sampleRate: number,
  startSec: number,
  endSec: number
): Float32Array {
  const startIdx = Math.floor(startSec * sampleRate);
  const endIdx = Math.min(Math.ceil(endSec * sampleRate), samples.length);
  return samples.slice(startIdx, endIdx);
}

/**
 * Decode a WAV ArrayBuffer to Float32Array (mono, resampled to targetSampleRate if needed)
 */
export async function decodeAudioBuffer(
  arrayBuffer: ArrayBuffer,
  targetSampleRate = 16000
): Promise<Float32Array> {
  const audioCtx = new OfflineAudioContext(1, 1, targetSampleRate);
  const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  
  if (decoded.sampleRate === targetSampleRate && decoded.numberOfChannels === 1) {
    return decoded.getChannelData(0);
  }
  
  // Resample
  const offlineCtx = new OfflineAudioContext(
    1,
    Math.ceil(decoded.duration * targetSampleRate),
    targetSampleRate
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = decoded;
  source.connect(offlineCtx.destination);
  source.start(0);
  const rendered = await offlineCtx.startRendering();
  return rendered.getChannelData(0);
}

/**
 * Format seconds to SRT timestamp: HH:MM:SS,mmm
 */
export function toSRTTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Format seconds to ASS timestamp: H:MM:SS.cc
 */
export function toASSTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const cs = Math.round((secs % 1) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}
