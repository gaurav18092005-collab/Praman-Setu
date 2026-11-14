import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { localeSchema } from '@pramansetu/shared';
import { z } from 'zod';
import { config, isTest } from '../config';
import { ApiError, asyncHandler } from '../errors';
import { logger } from '../logger';

const ttsSchema = z.object({
  text: z.string().trim().min(1).max(config.ttsMaxChars),
  locale: localeSchema.default('en'),
});

const LANGUAGE_CODES = {
  en: 'en-IN',
  hi: 'hi-IN',
  pa: 'pa-IN',
  ur: 'ur-IN',
  mr: 'mr-IN',
} as const;

/**
 * Azure and Google both expose neural voices for the five interface
 * languages. Names are intentionally kept here rather than in client code so
 * a voice change never requires an app release.
 */
const AZURE_VOICES = {
  en: 'en-IN-NeerjaNeural',
  hi: 'hi-IN-SwaraNeural',
  pa: 'pa-IN-OjasNeural',
  ur: 'ur-PK-UzmaNeural',
  mr: 'mr-IN-AarohiNeural',
} as const;

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function azureSpeech(text: string, locale: keyof typeof AZURE_VOICES): Promise<Buffer> {
  if (!config.azureSpeechKey || !config.azureSpeechRegion) {
    throw new ApiError(503, 'Online voice is not configured.', 'tts_disabled');
  }
  const ssml = [
    `<speak version="1.0" xml:lang="${LANGUAGE_CODES[locale]}">`,
    `<voice name="${AZURE_VOICES[locale]}">`,
    `<prosody rate="0%">${xmlEscape(text)}</prosody>`,
    '</voice></speak>',
  ].join('');
  const response = await fetch(
    `https://${config.azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`,
    {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': config.azureSpeechKey,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
        'User-Agent': 'Pramansetu',
      },
      body: ssml,
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) {
    logger.warn({ provider: 'azure', status: response.status }, 'TTS provider rejected a request');
    throw new ApiError(502, 'Online voice is not available right now.', 'tts_failed');
  }
  return Buffer.from(await response.arrayBuffer());
}

async function googleSpeech(text: string, locale: keyof typeof LANGUAGE_CODES): Promise<Buffer> {
  if (!config.googleTtsApiKey) {
    throw new ApiError(503, 'Online voice is not configured.', 'tts_disabled');
  }
  const response = await fetch(
    `https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(
      config.googleTtsApiKey,
    )}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        input: { text },
        voice: { languageCode: LANGUAGE_CODES[locale], ssmlGender: 'FEMALE' },
        audioConfig: { audioEncoding: 'MP3', speakingRate: 1 },
      }),
      signal: AbortSignal.timeout(12_000),
    },
  );
  if (!response.ok) {
    logger.warn({ provider: 'google', status: response.status }, 'TTS provider rejected a request');
    throw new ApiError(502, 'Online voice is not available right now.', 'tts_failed');
  }
  const data = (await response.json()) as { audioContent?: string };
  if (!data.audioContent) {
    throw new ApiError(502, 'Online voice returned no audio.', 'tts_failed');
  }
  return Buffer.from(data.audioContent, 'base64');
}

export function speechRouter(): Router {
  const router = Router();
  const limiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 40,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skip: () => isTest,
  });

  router.get('/status', (_req, res) => {
    res.json({
      enabled: config.ttsProvider !== 'none',
      provider: config.ttsProvider,
      maxChars: config.ttsMaxChars,
    });
  });

  router.post(
    '/tts',
    limiter,
    asyncHandler(async (req, res) => {
      if (config.ttsProvider === 'none') {
        throw new ApiError(503, 'Online voice is not available right now.', 'tts_disabled');
      }
      const input = ttsSchema.parse(req.body);
      const text = input.text.replace(/\s+/g, ' ').trim();
      if (!text) {
        throw new ApiError(400, 'There is no text to read.', 'tts_empty');
      }

      let audio: Buffer;
      try {
        audio =
          config.ttsProvider === 'azure'
            ? await azureSpeech(text, input.locale)
            : await googleSpeech(text, input.locale);
      } catch (error) {
        if (error instanceof ApiError) throw error;
        logger.error({ err: error, provider: config.ttsProvider }, 'TTS provider request failed');
        throw new ApiError(502, 'Online voice is not available right now.', 'tts_failed');
      }

      res.setHeader('Cache-Control', 'private, max-age=86400');
      res.type('audio/mpeg').send(audio);
    }),
  );

  return router;
}
