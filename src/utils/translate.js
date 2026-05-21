const axios = require('axios');

// DeepL free tier: api-free.deepl.com | Paid tier: api.deepl.com
// Set DEEPL_TIER=paid in .env to use paid tier
const DEEPL_API_URL = process.env.DEEPL_TIER === 'paid'
  ? 'https://api.deepl.com/v2/translate'
  : 'https://api-free.deepl.com/v2/translate';

/**
 * translateText
 *
 * Translates a single string using the DeepL API.
 * Uses the free tier endpoint (api-free.deepl.com).
 * Paid accounts should use api.deepl.com instead.
 *
 * @param {string} text       — source text
 * @param {string} targetLang — DeepL language code, e.g. 'FR', 'EN'
 * @param {string} sourceLang — optional source hint, e.g. 'EN'
 * @returns {Promise<string>} — translated text
 */
async function translateText(text, targetLang, sourceLang = null, attempt = 1) {
  if (!text?.trim()) return text;
  if (!process.env.DEEPL_API_KEY) {
    console.warn('[Translate] DEEPL_API_KEY not set — skipping translation');
    return null;
  }

  // RB10: Check quota before translating — DeepL returns 456 on quota exceeded
  // We track this in memory to avoid hammering the API once quota is hit
  if (translateText._quotaExceeded) {
    console.warn('[Translate] DeepL quota exceeded — skipping translation until restart');
    return null;
  }

  const params = {
    text,
    target_lang: targetLang.toUpperCase(),
  };
  if (sourceLang) params.source_lang = sourceLang.toUpperCase();

  try {
    // Use Authorization header — keeps API key out of server access logs
    const res = await axios.post(DEEPL_API_URL, null, {
      params,
      headers: { Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}` },
      timeout: 10000,
    });
    return res.data.translations?.[0]?.text || null;
  } catch (err) {
    // RB10: DeepL quota exceeded (456) — stop translating, log clearly
    if (err.response?.status === 456) {
      translateText._quotaExceeded = true;
      console.error('[Translate] ⚠️  DeepL monthly quota EXCEEDED — translations stopped until next billing cycle or plan upgrade. Check https://www.deepl.com/pro-account/usage');
      return null; // return null gracefully — deal saved in English
    }
    // Retry once on transient network errors (429 rate limit or 5xx)
    const isRetryable = !err.response || err.response.status === 429 || err.response.status >= 500;
    if (attempt < 2 && isRetryable) {
      const delay = err.response?.status === 429 ? 5000 : 1500; // back off more on rate limit
      await new Promise((r) => setTimeout(r, delay));
      return translateText(text, targetLang, sourceLang, 2);
    }
    throw err;
  }
}

/**
 * translateDeal
 *
 * Given a deal object with title + description in the source language,
 * returns { titleFr, descriptionFr } by translating to French.
 *
 * Called in the background after a deal is saved — never blocks the
 * admin's save request.
 */
async function translateDeal(deal) {
  const [titleFr, descriptionFr] = await Promise.all([
    translateText(deal.title,       'FR'),
    translateText(deal.description, 'FR'),
  ]);
  return { titleFr, descriptionFr };
}

/**
 * translateStore
 *
 * Translates store name + description to French.
 */
async function translateStore(store) {
  // Store names are proper nouns — not translated.
  // Only description is localised.
  const descriptionFr = store.description
    ? await translateText(store.description, 'FR')
    : null;
  return { descriptionFr };
}

module.exports = { translateText, translateDeal, translateStore };
