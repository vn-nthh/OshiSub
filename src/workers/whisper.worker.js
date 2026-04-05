// whisper.worker.js — Whisper WebGPU/WASM transcription worker (fp16 only)
//
// Uses dynamic import so we can catch and report import failures.

console.log('[whisper-worker] Worker script started');

// Catch any uncaught errors so the main thread knows something went wrong
self.addEventListener('error', (e) => {
  console.error('[whisper-worker] uncaught error:', e);
  self.postMessage({ type: 'error', payload: `Worker uncaught error: ${e.message}` });
});

self.addEventListener('unhandledrejection', (e) => {
  console.error('[whisper-worker] unhandled rejection:', e.reason);
  self.postMessage({ type: 'error', payload: `Worker unhandled rejection: ${e.reason}` });
});

const DEFAULT_MODEL_ID = 'onnx-community/whisper-large-v3-turbo';
const DTYPE = { encoder_model: 'fp16', decoder_model_merged: 'fp16' };

// ── Lazy-loaded transformers API ──────────────────────────────────────────────
let transformers = null;

async function getTransformers() {
  if (!transformers) {
    console.log('[whisper-worker] Importing @huggingface/transformers…');
    try {
      transformers = await import('@huggingface/transformers');
      console.log('[whisper-worker] Import succeeded, version:', transformers.env?.version);
      transformers.env.allowLocalModels = false;
      transformers.env.allowRemoteModels = true;
    } catch (err) {
      console.error('[whisper-worker] Failed to import @huggingface/transformers:', err);
      self.postMessage({ type: 'error', payload: `Failed to import transformers library: ${err.message ?? err}` });
      throw err;
    }
  }
  return transformers;
}

// ── Singleton pipeline ────────────────────────────────────────────────────────
let processor = null;
let model = null;
let currentModelId = null;

async function loadModel(modelId, device, progress_callback) {
  const { AutoProcessor, AutoModelForSpeechSeq2Seq } = await getTransformers();

  if (currentModelId && currentModelId !== modelId) {
    model?.dispose?.();
    model = null;
    processor = null;
    currentModelId = null;
  }
  if (!processor) {
    console.log('[whisper-worker] Loading processor…');
    processor = await AutoProcessor.from_pretrained(modelId, {
      progress_callback,
    });
    console.log('[whisper-worker] Processor loaded');
  }
  if (!model) {
    console.log(`[whisper-worker] Loading model on ${device}…`);
    model = await AutoModelForSpeechSeq2Seq.from_pretrained(modelId, {
      dtype: DTYPE,
      device,
      progress_callback,
    });
    currentModelId = modelId;
    console.log('[whisper-worker] Model loaded');
  }
  return { processor, model };
}

// ── Message handler ───────────────────────────────────────────────────────────
self.addEventListener('message', async (event) => {
  const { type, payload } = event.data;
  console.log('[whisper-worker] Received message:', type);

  if (type === 'load') {
    const modelId = payload?.modelId || DEFAULT_MODEL_ID;
    console.log('[whisper-worker] Loading model:', modelId);

    // Try WebGPU first, then fall back to WASM
    for (const device of ['webgpu', 'wasm']) {
      try {
        self.postMessage({ type: 'status', payload: `Loading Whisper on ${device} (fp16)…` });

        // Dispose previous model if any
        model?.dispose?.();
        model = null;
        processor = null;
        currentModelId = null;

        await loadModel(modelId, device, (p) => {
          // Log ALL progress events for debugging
          if (p.status === 'progress' && p.file) {
            console.log(`[whisper-worker] ${p.file}: ${Math.round(p.progress ?? 0)}%`);
          } else {
            console.log('[whisper-worker] progress event:', p.status, p.file ?? '');
          }

          if (p.status === 'progress') {
            self.postMessage({
              type: 'download-progress',
              payload: {
                status: 'progress',
                progress: p.progress ?? 0,
                file: p.file ?? p.name ?? '',
                loaded: p.loaded ?? 0,
                total: p.total ?? 0,
              },
            });
          } else if (p.status === 'initiate') {
            self.postMessage({
              type: 'download-progress',
              payload: {
                status: 'initiate',
                progress: 0,
                file: p.file ?? p.name ?? '',
              },
            });
            self.postMessage({
              type: 'status',
              payload: `Downloading ${p.file ?? p.name ?? 'file'}…`,
            });
          } else if (p.status === 'download') {
            self.postMessage({
              type: 'status',
              payload: `Downloading ${p.file ?? p.name ?? 'file'}…`,
            });
          } else if (p.status === 'done') {
            self.postMessage({
              type: 'download-progress',
              payload: {
                status: 'done',
                progress: 100,
                file: p.file ?? p.name ?? '',
              },
            });
          } else if (p.status === 'progress_total') {
            self.postMessage({
              type: 'download-progress',
              payload: {
                status: 'progress',
                progress: p.progress ?? 0,
                file: 'total',
                loaded: p.loaded ?? 0,
                total: p.total ?? 0,
              },
            });
          }
        });

        self.postMessage({ type: 'ready', payload: { device, dtype: 'fp16' } });
        console.log(`[whisper-worker] Model ready on ${device}`);
        return; // success — stop trying devices
      } catch (err) {
        console.error(`[whisper-worker] ${device} failed:`, err);
        self.postMessage({
          type: 'status',
          payload: `${device} failed: ${err?.message ?? String(err)}`,
        });
        // Clean up before trying next device
        model?.dispose?.();
        model = null;
        processor = null;
        currentModelId = null;
      }
    }

    // All devices failed
    self.postMessage({
      type: 'error',
      payload: 'Failed to load Whisper on both WebGPU and WASM.',
    });
  } else if (type === 'run') {
    const { audio, segmentStartSec, language, audioDurationSec, prompt } = payload;

    try {
      if (!processor || !model) {
        throw new Error('Model not loaded. Send a "load" message first.');
      }

      const { TextStreamer } = await getTransformers();

      self.postMessage({ type: 'status', payload: 'Processing audio…' });
      const inputs = await processor(audio, { sampling_rate: 16000 });

      self.postMessage({ type: 'status', payload: 'Generating transcript…' });

      const streamer = new TextStreamer(processor.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => {
          self.postMessage({ type: 'partial', payload: text });
        },
      });

      // Scale max_new_tokens to segment duration (~15 tokens/sec).
      const duration = audioDurationSec ?? (audio.length / 16000);
      const maxTokens = Math.min(448, Math.max(32, Math.round(duration * 15)));
      console.log(`[whisper-worker] segment ${duration.toFixed(1)}s → maxTokens=${maxTokens}${prompt ? ` prompt="${prompt}"` : ''}`);

      // Build generate options
      const generateOpts = {
        ...inputs,
        max_new_tokens: maxTokens,
        language: language ?? null,
        task: 'transcribe',
        return_timestamps: true,
        force_full_sequences: false,
        streamer,
      };

      // NOTE: Whisper prompt_ids is NOT supported in transformers.js yet (PR #1540 unmerged).
      // Keyterms only work with the Groq API path. For local model, we log and skip.
      if (prompt) {
        console.log(`[whisper-worker] keyterms "${prompt}" — local model doesn't support prompt conditioning, will be ignored`);
      }

      const generateResult = await model.generate(generateOpts);
      // Debug: log exactly what generate() returned
      console.log('[whisper-worker] generateResult keys:', Object.keys(generateResult));
      
      // generate() returns an ORT _Tensor (not transformers.js Tensor)
      // with dims [1, N] and BigInt64Array data
      let outputIds = generateResult.sequences ?? generateResult;
      
      // Convert to plain number arrays manually
      const data = outputIds.data; // BigInt64Array
      const numTokens = outputIds.dims?.[1] ?? data.length;
      const batchSize = outputIds.dims?.[0] ?? 1;
      
      const allChunks = [];
      
      for (let b = 0; b < batchSize; b++) {
        const start = b * numTokens;
        const tokenIds = [];
        for (let i = start; i < start + numTokens; i++) {
          tokenIds.push(Number(data[i]));
        }
        
        console.log('[whisper-worker] tokenIds length:', tokenIds.length, 'first 10:', tokenIds.slice(0, 10));
        
        // Parse timestamps from token IDs directly.
        // Whisper timestamp tokens start at 50365 (<|0.00|>) with 0.02s resolution
        const TIMESTAMP_BEGIN = 50365;
        const TIME_PRECISION = 0.02;
        
        let currentStart = segmentStartSec;
        let currentEnd = segmentStartSec;
        let currentTokens = [];
        
        for (const tid of tokenIds) {
          if (tid >= TIMESTAMP_BEGIN) {
            // This is a timestamp token
            const timeVal = (tid - TIMESTAMP_BEGIN) * TIME_PRECISION;
            
            if (currentTokens.length > 0) {
              // Decode the collected text tokens
              const text = processor.tokenizer.decode(currentTokens, { skip_special_tokens: true }).trim();
              if (text) {
                allChunks.push({
                  start: segmentStartSec + currentStart,
                  end: segmentStartSec + timeVal,
                  text,
                });
              }
              currentTokens = [];
            }
            currentStart = timeVal;
            currentEnd = timeVal;
          } else if (tid < 50257) {
            // Regular text token (skip special tokens like <|startoftranscript|>, <|en|>, etc.)
            currentTokens.push(tid);
          }
        }
        
        // Flush remaining tokens
        if (currentTokens.length > 0) {
          const text = processor.tokenizer.decode(currentTokens, { skip_special_tokens: true }).trim();
          if (text) {
            allChunks.push({
              start: segmentStartSec + currentStart,
              end: segmentStartSec + currentEnd + 2,
              text,
            });
          }
        }
      }

      // Fallback: if no timestamp chunks were parsed, decode everything as plain text
      if (allChunks.length === 0) {
        const allTokens = Array.from(data).map(Number).filter(t => t < 50257);
        const plain = processor.tokenizer.decode(allTokens, { skip_special_tokens: true }).trim();
        if (plain) {
          allChunks.push({
            start: segmentStartSec,
            end: segmentStartSec + audio.length / 16000,
            text: plain,
          });
        }
      }
      
      console.log('[whisper-worker] parsed chunks:', allChunks.length);
      self.postMessage({ type: 'done', payload: allChunks });
    } catch (err) {
      console.error('[whisper-worker] run error:', err);
      self.postMessage({ type: 'error', payload: String(err) });
    }
  }
});

console.log('[whisper-worker] Message listener registered');
