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

  // Build form-encoded body — keeps translated text out of URL/access logs
  const formParams = new URLSearchParams({
    text,
    target_lang: targetLang.toUpperCase(),
  });
  if (sourceLang) formParams.set('source_lang', sourceLang.toUpperCase());

  try {
    // POST body (not URL params) — text content never appears in access logs
    const res = await axios.post(DEEPL_API_URL, formParams.toString(), {
      headers: {
        Authorization: `DeepL-Auth-Key ${process.env.DEEPL_API_KEY}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      timeout: 10000,
    });
    return res.data.translations?.[0]?.text || null;
  } catch (err) {
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
  const [nameFr, descriptionFr] = await Promise.all([
    translateText(store.name,        'FR'),
    translateText(store.description, 'FR'),
  ]);
  return { nameFr, descriptionFr };
}

module.exports = { translateText, translateDeal, translateStore };
