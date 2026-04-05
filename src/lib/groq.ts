// Groq API client — transcription + translation (BYOK)

import type { TranscriptChunk } from '@/types';
import { encodeWAV } from './audioUtils';

// ─── Transcription ────────────────────────────────────────────────────────────
const GROQ_TRANSCRIBE_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';

interface GroqVerboseResponse {
  text: string;
  segments?: Array<{
    start: number;
    end: number;
    text: string;
  }>;
}

/**
 * Transcribe a Float32Array audio segment using Groq API.
 * Returns chunks with timestamps offset by segmentStartSec.
 */
export async function transcribeWithGroq(
  audioSamples: Float32Array,
  sampleRate: number,
  segmentStartSec: number,
  apiKey: string,
  language?: string,
  prompt?: string
): Promise<TranscriptChunk[]> {
  const wav = encodeWAV(audioSamples, sampleRate);
  const blob = new Blob([wav], { type: 'audio/wav' });

  const formData = new FormData();
  formData.append('file', blob, 'audio.wav');
  formData.append('model', GROQ_TRANSCRIBE_MODEL);
  formData.append('response_format', 'verbose_json');
  formData.append('timestamp_granularities[]', 'segment');
  if (language) formData.append('language', language);
  if (prompt) formData.append('prompt', prompt);

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq transcription error ${response.status}: ${err}`);
  }

  const data: GroqVerboseResponse = await response.json();

  if (!data.segments || data.segments.length === 0) {
    return [
      {
        id: crypto.randomUUID(),
        start: segmentStartSec,
        end: segmentStartSec + audioSamples.length / sampleRate,
        text: data.text,
      },
    ];
  }

  return data.segments.map((seg) => ({
    id: crypto.randomUUID(),
    start: segmentStartSec + seg.start,
    end: segmentStartSec + seg.end,
    text: seg.text,
  }));
}

// ─── Translation ──────────────────────────────────────────────────────────────
const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_TRANSLATE_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';

/**
 * Translate an array of subtitle texts using Groq chat API.
 * Batches all lines in one request for efficiency.
 */
export async function translateWithGroq(
  texts: string[],
  targetLanguage: string,
  apiKey: string,
  instructions?: string
): Promise<string[]> {
  if (texts.length === 0) return [];

  const numbered = texts.map((t, i) => `${i + 1}. ${t}`).join('\n');
  const customInstructions = instructions ? `\nAdditional instructions from the user: ${instructions}` : '';

  const systemPrompt = `You are a subtitle translator. You are translating lines from a spoken conversation (e.g. a livestream, podcast, or video). Use the conversational context to understand intent, tone, and references, but do not let it compromise translation accuracy — translate what was actually said, not what you think sounds better.${customInstructions}`;

  const userPrompt = `Translate the following numbered subtitle lines to ${targetLanguage}.
Return ONLY the translated lines in the same numbered format (1. translation, 2. translation, etc.).
Do not add explanations, commentary, or change the numbering.

${numbered}`;

  const response = await fetch(GROQ_CHAT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_TRANSLATE_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Groq translation error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const content: string = data.choices?.[0]?.message?.content ?? '';

  // Parse numbered list back
  const lines = content.split('\n').filter(Boolean);
  const result: string[] = new Array(texts.length).fill('');
  for (const line of lines) {
    const match = line.match(/^(\d+)\.\s*(.*)/);
    if (match) {
      const idx = parseInt(match[1], 10) - 1;
      if (idx >= 0 && idx < texts.length) result[idx] = match[2].trim();
    }
  }
  return result;
}
