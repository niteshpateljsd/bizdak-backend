const axios = require('axios');

const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate';

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
async function translateText(text, targetLang, sourceLang = null) {
  if (!text?.trim()) return text;
  if (!process.env.DEEPL_API_KEY) {
    console.warn('[Translate] DEEPL_API_KEY not set — skipping translation');
    return null;
  }

  const params = {
    auth_key:    process.env.DEEPL_API_KEY,
    text,
    target_lang: targetLang.toUpperCase(),
  };
  if (sourceLang) params.source_lang = sourceLang.toUpperCase();

  const res = await axios.post(DEEPL_API_URL, null, { params });
  return res.data.translations?.[0]?.text || null;
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
