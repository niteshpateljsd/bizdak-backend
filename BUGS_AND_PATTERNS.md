# Bizdak — Deep Debug Session: Bug Patterns & Lessons Learned

This file documents every recurring bug category, anti-pattern, and architectural
gotcha discovered across multiple exhaustive backend review passes. When starting
a new review session (mobile, admin, or a fresh backend pass), read this file first
and apply these lenses to every file.

---

## 1. JAVASCRIPT SILENT FAILURES

### Duplicate object keys
**The bug:** Two identical keys in the same JS/Prisma where object — second silently
overwrites the first. Zero error. Zero warning.

**Where it hit:** `city.controller getCityPack` — two `OR:` keys at the same level.
The endDate filter was silently overwritten by the startDate filter. Expired deals
were being returned in the city pack to every mobile user.

**Pattern to check:** Any Prisma `where:{}` that needs to combine two `OR` conditions
MUST use `AND: [{ OR: [...] }, { OR: [...] }]`. Never two `OR:` keys at same level.

**Also check:** `theme.js` in mobile had `spacing`, `radius`, `typography`, `shadow`
all defined TWICE. Second definition silently wins. Always grep for duplicate `const`
or `export const` in the same file.

---

## 2. MASS ASSIGNMENT / MISSING FIELD WHITELISTS

**The bug:** `req.body` passed directly (or via spread `...req.body`) into a Prisma
`create()` or `update()`. An admin can set any field — `viewCount`, `isActive`,
`cityId`, `id` — to arbitrary values.

**Where it hit:** city.create, city.update, store.create, store.update, deal.create,
deal.update, campaign.create — ALL had this. Also `...data` spread into campaign.create
still had it even after partial fixes.

**Pattern to check:** Every controller create/update function. Look for `data: req.body`
or `data: { ...req.body }` or `const { x, ...rest } = req.body; prisma.model.create({data: rest})`.
Every one of these needs an explicit whitelist:
```js
const data = {};
const allowed = ['field1', 'field2'];
allowed.forEach(k => { if (rawBody[k] !== undefined) data[k] = rawBody[k]; });
```

---

## 3. RACE CONDITIONS ON STATE FLAGS

**The bug:** Check a flag → do work → set the flag. Between check and set, another
concurrent request passes the same check. Both proceed. Double-send, double-charge,
double-fire.

**Where it hit:** `campaign.controller send` — checked `sentAt === null`, then sent
FCM, then set `sentAt`. Two simultaneous admin clicks = two FCM sends to all users.

**Fix pattern:** Atomic `updateMany` with the condition baked in:
```js
const lock = await prisma.model.updateMany({
  where: { id, flagField: null },
  data: { flagField: new Date() },
});
if (lock.count === 0) return res.status(409).json({ error: 'Already processed.' });
```

**Also:** Set the flag AFTER the external call (FCM, email, payment), not before.
If the external call fails, you need to roll back. If you set first and call second,
failure leaves you in a permanently stuck state with no retry possible.

---

## 4. MISSING STARTUP VALIDATION

**The bug:** Server starts successfully even when critical env vars are missing.
First real request then fails with a cryptic internal error.

**Where it hit:** `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`,
`FIREBASE_*` env vars were all missing startup guards.

**Pattern to check:** `src/index.js` or `src/app.js` — validate ALL critical env
vars at the very top, before any `require()` calls that use them. Call `process.exit(1)`
with a clear message if any are missing.

**Also check:** Minimum length/format constraints — `JWT_SECRET` needs ≥ 32 chars.
A 3-character secret is technically valid but cryptographically broken.

---

## 5. FIREBASE / EXTERNAL SERVICE ERRORS NOT ROLLED BACK

**The bug:** Database state updated optimistically before external call. If the
external call fails, DB is in a state that says "done" but work was never actually
done. No way to retry.

**Where it hit:** `campaign.controller send` — `sentAt` written to DB before FCM
fires. FCM failure → campaign stuck as "sent", notification never delivered.

**Fix pattern:**
```js
// 1. Lock optimistically
await prisma.model.updateMany({ where: { id, status: 'pending' }, data: { status: 'processing' } });
// 2. Do external work
try {
  await externalService.call();
} catch (err) {
  // 3. Roll back on failure
  await prisma.model.update({ where: { id }, data: { status: 'pending' } }).catch(() => {});
  throw err;
}
// 4. Confirm success
await prisma.model.update({ where: { id }, data: { status: 'done' } });
```

---

## 6. SEQUENTIAL QUERIES THAT SHOULD BE PARALLEL

**The bug:** Multiple independent `await prisma.x()` calls chained sequentially.
Each waits for the previous. Total time = sum of all query times instead of max.

**Where it hit:**
- `event.controller getEventStats` — 11 sequential queries. Parallelised to ~1/10th response time.
- `city.controller getCityPack` — tags fetched after stores+deals instead of alongside.
- `analytics.controller overview` — 7 queries, already using Promise.all (correct).

**Pattern to check:** Any function with 2+ `await prisma.` calls on independent data.
Replace with:
```js
const [result1, result2, result3] = await Promise.all([
  prisma.model1.findMany(...),
  prisma.model2.count(...),
  prisma.model3.aggregate(...),
]);
```

---

## 7. BIGINT FROM POSTGRESQL RAW QUERIES

**The bug:** PostgreSQL `COUNT()` returns BigInt. JSON.stringify silently drops BigInt
values (they become `undefined`). `Number()` cast required.

**Where it hit:** `event.controller getEventStats` raw queries — `COUNT(DISTINCT deviceId)`,
`COUNT(*) AS events`, `COUNT(DISTINCT deviceId) AS devices`.

**Pattern to check:** Any `prisma.$queryRaw` that uses `COUNT`, `SUM`, `AVG`.
Always wrap in `Number(r.fieldName)` when mapping results.
Add `::int` cast in SQL for clean conversion: `COUNT(*)::int AS count`.

---

## 8. CLOUDINARY ASSETS ORPHANED ON DELETE/UPDATE

**The bug:** Deleting or updating a store/deal removes the DB record but leaves
the image/video in Cloudinary forever. Storage bill grows silently.

**Where it hit:** store.remove, deal.remove, store.update, deal.update — all four
were missing Cloudinary cleanup.

**Fix pattern:**
```js
// BEFORE delete/update: fetch current asset URLs
const existing = await prisma.model.findUnique({ where: { id }, select: { imageUrl, videoUrl } });

// AFTER successful DB operation: clean up replaced/deleted assets
setImmediate(async () => {
  const jobs = [];
  if (existing?.imageUrl) jobs.push(deleteAsset(extractPublicId(existing.imageUrl), 'image'));
  if (existing?.videoUrl) jobs.push(deleteAsset(extractPublicId(existing.videoUrl), 'video'));
  await Promise.allSettled(jobs); // allSettled — never fail because of cleanup
});
```

**Rules:**
- Always `setImmediate` — never block the HTTP response for asset cleanup
- Always `Promise.allSettled` — one failed cleanup never blocks others
- Only delete OLD asset if it was actually REPLACED (compare old vs new URL)
- Fetch assets BEFORE the DB delete (cascade removes child records)

---

## 9. CROSS-ENTITY VALIDATION GAPS

**The bug:** Creating a deal for city A but attaching a store from city B. Or
creating a campaign for Dakar and linking Houston deals. DB allows it, app breaks.

**Where it hit:** deal.create, campaign.create — storeId/cityId cross-checks missing.
Also: campaign tagSlug not verified to exist in DB — notification sent to ghost FCM
topic reaching zero devices.

**Pattern to check:** Any `create` that takes both a parent entity ID (cityId, storeId)
AND references to other entities. Always verify the referenced entities belong to
the expected parent:
```js
const store = await prisma.store.findFirst({ where: { id: storeId, cityId } });
if (!store) return res.status(422).json({ error: 'Store does not belong to this city.' });
```

---

## 10. MISSING 404 BEFORE EXPENSIVE OPERATIONS

**The bug:** Fetch assets → do expensive work → DB operation throws P2025 (not found).
The asset fetch was wasted. Error message is also less clear than an explicit 404.

**Where it hit:** store.update and deal.update — fetched assets for Cloudinary cleanup
before verifying the record exists. If ID is invalid, wasted a DB query then got
a cryptic Prisma error.

**Pattern:** Always validate existence early:
```js
const existing = await prisma.model.findUnique({ where: { id }, select: { imageUrl: true } });
if (!existing) return res.status(404).json({ error: 'X not found.' });
// Now safe to proceed
```

---

## 11. MISSING INPUT NORMALISATION

**The bug:** Case-sensitive comparisons on user input. `DAKAR` ≠ `dakar`. `Admin@` ≠ `admin@`.
Leading/trailing whitespace stored in DB causes silent lookup failures.

**Where it hit:**
- `auth.controller login` — email comparison was case-sensitive
- `event.controller ingest` — citySlug stored as-is, `DAKAR` events never grouped with `dakar`
- `tag.controller create` — name/slug not trimmed, `" food "` stored with spaces

**Pattern:** Normalise all string inputs at the point of ingestion:
```js
const email = req.body.email?.toLowerCase().trim();
const citySlug = req.body.citySlug?.toLowerCase().trim();
const slug = req.body.slug?.trim();
```

---

## 12. DEAL/STORE ACTIVE STATUS FILTER GAPS

**The bug:** Several endpoints checked `isActive: true` but forgot that a deal can
be `isActive: true` AND have a past `endDate` (cron job runs at 02:00, not instantly).
Window of expired-but-active deals: up to 24 hours.

**Also:** Deals with a future `startDate` included in city pack — mobile showed
unreleased deals.

**The complete active deal filter:**
```js
where: {
  isActive: true,
  AND: [
    { OR: [{ endDate: { gte: new Date() } }, { endDate: null }] },    // not expired
    { OR: [{ startDate: { lte: new Date() } }, { startDate: null }] }, // started already
  ],
}
```

**Where gaps were found:** city pack, topDeals analytics, store list _count.deals,
deal.controller list (endDate handled, startDate was missing).

---

## 13. NO GRACEFUL SHUTDOWN

**The bug:** No SIGTERM/SIGINT handler. On Render/Railway, a new deploy sends SIGTERM
then kills the process after ~10s. Without a handler, in-flight HTTP requests are
dropped mid-response and Prisma connection pool leaks.

**Fix in `src/index.js`:**
```js
async function shutdown(signal) {
  server.close(async () => {
    await prisma.$disconnect().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000); // force exit if stuck
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));
```

---

## 14. MORGAN LOGGING DEAD CODE

**The bug:** Nested conditionals that re-check the same condition inside an already-
checked branch. Inner check always evaluates to the else case.

**Where it hit:** `app.js` morgan block — outer `if (production)` used 'combined',
inner `else` had another ternary `production ? 'combined' : 'dev'` that always
resolved to 'dev' (because we're already in the else branch).

**Pattern:** After any if/else refactor, re-read the full block. Especially watch
for ternaries inside else branches that re-test the same condition.

---

## 15. ERROR MIDDLEWARE GAPS

**Gaps found in `error.middleware.js`:**
- Multer `LIMIT_FILE_SIZE` was returning 500 instead of 413
- CORS errors (`err.message.startsWith('CORS:')`) were returning 500 instead of 403
- P2002 duplicate key errors didn't say WHICH field was duplicated (`err.meta.target`)

**Pattern:** Error middleware should handle every known error type explicitly:
```js
if (err.message?.startsWith('CORS:'))     → 403
if (err.name === 'MulterError')           → 413 or 400
if (err.code === 'P2002')                 → 409 with err.meta?.target field name
if (err.code === 'P2025')                 → 404
if (err.status || err.statusCode)         → that status
else                                      → 500
```

---

## 16. VALIDATION GAPS ON PUBLIC ENDPOINTS

**The bug:** Fields accepted by routes without format/range constraints. Attackers
or buggy mobile clients can send garbage that causes either DB errors or silent
bad data.

**Specific gaps found:**
- `discountPercent` — no 0-100 range check, could store 999%
- `website` — no URL protocol check, could store `javascript:` URIs
- `deviceId` — was validated as UUID, rejecting any non-UUID format silently
- `since` date in newdeals — no cap, `since=1970-01-01` scanned entire DB history
- `days` in event stats — no minimum, `days=0` returned empty results silently
- `?type` in upload — no validation, non-deal/store values went to wrong folder

---

## 17. TRANSLATE JOB SKIP CONDITION

**The bug:** `translateStoreById` skipped if `nameFr` existed, even when
`descriptionFr` was null. Stores with a name but no description were never
re-translated for the description.

**Pattern:** Skip only when ALL translatable fields are populated:
```js
// Wrong:
if (!force && store.nameFr) return;

// Correct:
if (!force && store.nameFr && store.descriptionFr) return;
```

---

## 18. SCHEMA MISSING INDEXES

**The bug:** Production queries do full table scans because indexes were never added
to frequently-queried columns.

**Indexes added:**
```prisma
model Deal     { @@index([cityId]) @@index([storeId]) @@index([isActive, cityId]) @@index([createdAt]) }
model Store    { @@index([cityId]) }
model Campaign { @@index([cityId]) @@index([sentAt]) }
model Event    { @@index([type, timestamp]) @@index([citySlug, timestamp]) @@index([storeId, type, timestamp]) @@index([deviceId]) }
```

**Pattern:** Every foreign key column and every column used in a `where:` filter
should have an index. Also add compound indexes for frequent multi-column filters.

---

## 19. MODULE-LOAD-TIME SIDE EFFECTS

**The bug:** Code that runs immediately when a module is `require()`'d — before
dotenv has loaded env vars, or before startup validation has run.

**Where it hit:**
- `jwt.js` — reads `process.env.JWT_SECRET` at module load time and calls `process.exit(1)`
- `cloudinary.js` — reads env vars at module load time
- `translate.js` — reads `DEEPL_TIER` at module load time

**Pattern:** Load order in `index.js` matters:
1. `require('dotenv').config()` FIRST
2. Validate critical env vars SECOND
3. `require('./app')` THIRD (which triggers all module loads)

This ensures env vars are populated before any module reads them.

---

## 20. CITY PACK PAYLOAD COMPLETENESS

**The bug:** Mobile app uses deeply nested data from the city pack. Missing fields
cause silent crashes or fallback to wrong language.

**Fields that were missing and were added:**
- `videoDuration` — not in store select → VideoPlayer showed no duration badge
- `descriptionFr` — not in deal's embedded store relation → French store descriptions
  unavailable when navigating from deal → store detail
- Tag `nameFr` — was incorrectly included (Tag model has no `nameFr`, only Store does) → Prisma crash

**Pattern:** Before shipping, trace every field the mobile uses from the city pack
response and verify it's explicitly selected/included in the query.

---

## KEY ARCHITECTURAL DECISIONS (DO NOT CHANGE WITHOUT CAREFUL THOUGHT)

1. **City pack is the source of truth for mobile** — mobile downloads once, caches locally.
   Any data missing from the pack is invisible to the app until next refresh.

2. **Analytics are anonymous** — `deviceId` is a random UUID per install. No user table.
   No location stored. No PII. This is intentional and must be preserved.

3. **FCM topics are city-based** — `city_dakar`, `city_dakar_food`. Users subscribe
   on onboarding. No user targeting. Privacy-first design.

4. **Cloudinary cleanup is always fire-and-forget** — never block HTTP response for
   asset cleanup. `setImmediate` + `Promise.allSettled` everywhere.

5. **DeepL translation is background** — translate after save, never block admin UX.
   French falls back to English if translation missing.

6. **Open-ended deals have `endDate: null`** — always filter with
   `OR: [{ endDate: { gte: new Date() } }, { endDate: null }]`, never just `endDate: { gte: now }`.

7. **Prisma shared client** — one `PrismaClient` instance for the whole app. Never
   call `$disconnect()` in a job or route handler — it kills the connection pool.

---

## CHECKLIST FOR REVIEWING ANY NEW FILE

- [ ] All `req.body` fields whitelisted before touching DB?
- [ ] All foreign key IDs validated as UUIDs before DB connect?
- [ ] Cross-entity ownership verified (does store belong to city)?
- [ ] No duplicate JS object keys in where clauses?
- [ ] Independent queries using `Promise.all`?
- [ ] External service calls (FCM, DeepL, Cloudinary) have rollback on failure?
- [ ] Cloudinary assets cleaned up on delete/update?
- [ ] Active deal filter uses the full AND[OR(endDate), OR(startDate)] pattern?
- [ ] All string inputs normalised (lowercase, trim)?
- [ ] Startup env var validation present?
- [ ] Explicit 404 before expensive operations on potentially-missing records?
- [ ] Rate limiting on all public endpoints?
- [ ] Error types handled specifically in error middleware?
- [ ] BigInt from raw SQL queries cast with `Number()`?
- [ ] Module load order: dotenv → validate → require app?

