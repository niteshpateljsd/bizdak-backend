const prisma = require('../utils/prisma');
const { translateDeal, translateStore } = require('../utils/translate');

/**
 * translateDealById
 *
 * Fetches the deal, translates title + description to French,
 * writes titleFr + descriptionFr back to the DB.
 *
 * Silently no-ops if:
 *   - Deal not found
 *   - DEEPL_API_KEY not set
 *   - Translation already exists (don't overwrite manual corrections)
 */
async function translateDealById(dealId, force = false) {
  try {
    const deal = await prisma.deal.findUnique({ where: { id: dealId } });
    if (!deal) return;

    // Skip if already translated and not forced
    if (!force && deal.titleFr && deal.descriptionFr) return;

    const { titleFr, descriptionFr } = await translateDeal(deal);
    if (!titleFr && !descriptionFr) return;

    await prisma.deal.update({
      where: { id: dealId },
      data: {
        ...(titleFr       ? { titleFr }       : {}),
        ...(descriptionFr ? { descriptionFr } : {}),
      },
    });
    console.log(`[Translate] Deal ${dealId} translated to FR`);
  } catch (err) {
    console.warn(`[Translate] Failed for deal ${dealId}:`, err.message);
  }
}

/**
 * translateStoreById
 *
 * Same as above for stores.
 */
async function translateStoreById(storeId, force = false) {
  try {
    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) return;

    // Only skip if BOTH translations exist — allows partial retranslation
    if (!force && store.nameFr && store.descriptionFr) return;

    const { nameFr, descriptionFr } = await translateStore(store);
    if (!nameFr && !descriptionFr) return;

    await prisma.store.update({
      where: { id: storeId },
      data: {
        ...(nameFr        ? { nameFr }        : {}),
        ...(descriptionFr ? { descriptionFr } : {}),
      },
    });
    console.log(`[Translate] Store ${storeId} translated to FR`);
  } catch (err) {
    console.warn(`[Translate] Failed for store ${storeId}:`, err.message);
  }
}

/**
 * backfillTranslations
 *
 * Translates all deals and stores that are missing French content.
 * Run once after enabling the feature, or via POST /api/admin/backfill-translations.
 * Processes in small batches to avoid hitting DeepL rate limits.
 */
async function backfillTranslations() {
  const BATCH = 10;
  const MAX_ITEMS = 500; // Safety cap — prevents multi-hour HTTP timeouts
                          // Run multiple times if you have more items

  // Fetch both in parallel — independent queries
  const [untranslatedDeals, untranslatedStores] = await Promise.all([
    prisma.deal.findMany({
      where: { titleFr: null },
      select: { id: true },
      take: MAX_ITEMS,
    }),
    prisma.store.findMany({
      where: { nameFr: null },
      select: { id: true },
      take: MAX_ITEMS,
    }),
  ]);

  console.log(`[Translate] Backfill: ${untranslatedDeals.length} deals, ${untranslatedStores.length} stores (capped at ${MAX_ITEMS} each)`);

  // Process deals in batches
  for (let i = 0; i < untranslatedDeals.length; i += BATCH) {
    const batch = untranslatedDeals.slice(i, i + BATCH);
    await Promise.all(batch.map((d) => translateDealById(d.id)));
    if (i + BATCH < untranslatedDeals.length) {
      await new Promise((r) => setTimeout(r, 500)); // small pause between batches
    }
  }

  // Process stores in batches
  for (let i = 0; i < untranslatedStores.length; i += BATCH) {
    const batch = untranslatedStores.slice(i, i + BATCH);
    await Promise.all(batch.map((s) => translateStoreById(s.id)));
    if (i + BATCH < untranslatedStores.length) {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  const [remainingDeals, remainingStores] = await Promise.all([
    prisma.deal.count({ where: { titleFr: null } }),
    prisma.store.count({ where: { nameFr: null } }),
  ]);

  return {
    deals:           untranslatedDeals.length,
    stores:          untranslatedStores.length,
    remainingDeals,
    remainingStores,
    complete:        remainingDeals === 0 && remainingStores === 0,
  };
}

module.exports = { translateDealById, translateStoreById, backfillTranslations };
