// translate.worker.ts — Phi-3.5-mini via @huggingface/transformers WebGPU
// Uses text-generation pipeline with chat-style prompting for translation.

import { pipeline, TextGenerationPipeline, env } from '@huggingface/transformers';

env.allowLocalModels = false;

const MODEL_ID = 'onnx-community/Phi-3.5-mini-instruct-onnx-web';

let generator: TextGenerationPipeline | null = null;

self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;

  if (type === 'load') {
    try {
      self.postMessage({ type: 'status', payload: 'Loading Phi-3.5 mini translation model…' });
      generator = await pipeline('text-generation', MODEL_ID, {
        device: 'webgpu',
        dtype: 'q4',
        progress_callback: (info: { status: string; file?: string; progress?: number }) => {
          if (info.status === 'downloading') {
            self.postMessage({
              type: 'download-progress',
              payload: { file: info.file ?? '', progress: info.progress ?? 0 },
            });
          } else if (info.status === 'loading') {
            self.postMessage({ type: 'status', payload: 'Loading weights…' });
          }
        },
      }) as TextGenerationPipeline;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      self.postMessage({ type: 'error', payload: String(err) });
    }

  } else if (type === 'translate') {
    if (!generator) {
      self.postMessage({ type: 'error', payload: 'Model not loaded' });
      return;
    }
    try {
      const { texts, targetLanguage, instructions } = payload as {
        texts: string[];
        targetLanguage: string;
        instructions?: string;
      };
      const results: string[] = [];

      for (let i = 0; i < texts.length; i++) {
        self.postMessage({ type: 'progress', payload: { current: i, total: texts.length } });

        const customInstr = instructions?.trim()
          ? `\nAdditional instructions: ${instructions.trim()}`
          : '';

        const messages = [
          {
            role: 'system',
            content: `You are a subtitle translator. Translate the given text to ${targetLanguage}. Return ONLY the translated text, nothing else. Do not add quotes, explanations, or formatting.${customInstr}`,
          },
          { role: 'user', content: texts[i] },
        ];

        const out = await generator(messages, {
          max_new_tokens: 256,
          do_sample: false,
        });

        // Extract generated text from the last assistant message
        const generated = out[0]?.generated_text;
        let translated = '';
        if (Array.isArray(generated)) {
          // Chat format returns array of messages
          const last = generated[generated.length - 1];
          translated = (typeof last === 'object' && last && 'content' in last)
            ? (last as { content: string }).content
            : String(last);
        } else if (typeof generated === 'string') {
          translated = generated;
        }

        results.push(translated.trim());
      }

      self.postMessage({ type: 'done', payload: results });
    } catch (err) {
      self.postMessage({ type: 'error', payload: String(err) });
    }
  }
};
