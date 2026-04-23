# Bizdak Backend API

Privacy-first local discovery platform. Businesses create deals and campaigns; users receive push notifications based on location and interests — **no user accounts, no tracking, no personal data stored on the server**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18+ |
| Framework | Express 4 |
| ORM | Prisma 5 |
| Database | PostgreSQL 14+ |
| Push notifications | Firebase Cloud Messaging (FCM) |
| Auth | JWT (admin only) |
| Validation | express-validator |

---

## Quick Start

### 1. Clone and install

```bash
git clone <repo-url>
cd bizdak-backend
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
```

Required variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Long random string for signing tokens |
| `FIREBASE_PROJECT_ID` | Firebase project ID |
| `FIREBASE_PRIVATE_KEY` | Firebase service account private key |
| `FIREBASE_CLIENT_EMAIL` | Firebase service account email |
| `ADMIN_EMAIL` | Admin login email |
| `ADMIN_PASSWORD` | Admin login password (plain for dev, bcrypt hash for prod) |

### 3. Database setup

```bash
npm run db:migrate     # Create tables
npm run db:generate    # Generate Prisma client
npm run db:seed        # Seed with sample data (Dakar, tags, stores, deals)
```

### 4. Run

```bash
npm run dev    # Development (nodemon)
npm start      # Production
```

Server starts on `http://localhost:3000`

---

## Project Structure

```
bizdak-backend/
├── prisma/
│   ├── schema.prisma          # Database schema
│   └── seed.js                # Dev seed data
├── src/
│   ├── index.js               # Entry point
│   ├── app.js                 # Express setup, middleware, routes
│   ├── controllers/
│   │   ├── auth.controller.js
│   │   ├── city.controller.js
│   │   ├── store.controller.js
│   │   ├── deal.controller.js
│   │   ├── tag.controller.js
│   │   ├── campaign.controller.js
│   │   ├── analytics.controller.js
│   │   ├── event.controller.js
│   │   ├── upload.controller.js
│   │   └── newdeals.controller.js
│   ├── routes/
│   │   ├── auth.routes.js
│   │   ├── city.routes.js
│   │   ├── store.routes.js
│   │   ├── deal.routes.js
│   │   ├── tag.routes.js
│   │   ├── campaign.routes.js
│   │   ├── analytics.routes.js
│   │   ├── event.routes.js
│   │   └── upload.routes.js
│   ├── middleware/
│   │   ├── auth.middleware.js      # JWT Bearer verification
│   │   ├── validate.middleware.js  # express-validator helper
│   │   └── error.middleware.js     # Global error handler
│   └── utils/
│       ├── prisma.js          # Prisma singleton
│       ├── firebase.js        # FCM sendToTopic + buildTopic
│       └── jwt.js             # signToken / verifyToken
└── .env.example
```

---

## API Reference

All admin routes require `Authorization: Bearer <token>`.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/auth/login` | No | Get JWT token |
| GET | `/api/auth/me` | Yes | Verify token + get role |

**Login**
```json
POST /api/auth/login
{ "email": "admin@bizdak.com", "password": "your-password" }

→ { "token": "eyJ..." }
```

---

### Cities

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/cities` | No | List all cities |
| GET | `/api/cities/:slug` | No | Get city by slug |
| GET | `/api/cities/:slug/pack` | No | Full city pack (stores + active deals) |
| POST | `/api/cities` | Yes | Create city |
| PUT | `/api/cities/:id` | Yes | Update city |
| DELETE | `/api/cities/:id` | Yes | Delete city |

**City pack** — the main endpoint the mobile app calls on first launch. Returns all stores and active deals for a city in one payload. No user data required.

```json
GET /api/cities/dakar/pack

→ {
  "city": { "id": "...", "name": "Dakar", "slug": "dakar", ... },
  "stores": [ { "id": "...", "name": "...", "lat": 14.69, "lng": -17.44, ... } ],
  "deals":  [ { "id": "...", "title": "...", "tags": [...], "store": {...}, ... } ],
  "tags":   [ { "id": "...", "name": "Food", "slug": "food", "children": [...] } ],
  "generatedAt": "2025-03-15T10:00:00.000Z"
}

Deals are capped at 500 per city pack. Deals are filtered to: `isActive=true`, `startDate <= now`, `endDate >= now OR endDate = null`.
```

---

### Stores

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/stores?cityId=` | No | List stores (filter by cityId) |
| GET | `/api/stores/:id` | No | Get store + its active deals |
| POST | `/api/stores/:id/view` | No | Increment view counter (analytics) |
| POST | `/api/stores` | Yes | Create store |
| PUT | `/api/stores/:id` | Yes | Update store |
| DELETE | `/api/stores/:id` | Yes | Delete store |

**Create store**
```json
POST /api/stores
{
  "name": "Marché Sandaga",
  "address": "Avenue Lamine Guèye, Dakar",
  "lat": 14.6937,
  "lng": -17.4441,
  "cityId": "uuid",
  "phone": "+221 XX XXX XX XX",   // optional
  "website": "https://..."         // optional
}
```

---

### Deals

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/deals?cityId=&storeId=&tag=` | No* | List deals (add `?includeInactive=true` with admin token to include inactive) |
| GET | `/api/deals/:id` | No | Get deal detail |
| POST | `/api/deals/:id/view` | No | Increment view counter |
| POST | `/api/deals` | Yes | Create deal |
| PUT | `/api/deals/:id` | Yes | Update deal (replaces tags) |
| DELETE | `/api/deals/:id` | Yes | Delete deal |

**Create deal**
```json
POST /api/deals
{
  "title": "30% off all fabrics",
  "description": "Wax print fabrics at 30% off. Limited stock.",
  "originalPrice": 5000,
  "discountedPrice": 3500,
  "discountPercent": 30,
  "startDate": "2025-03-15T00:00:00Z",
  "endDate": "2025-03-29T23:59:59Z",
  "cityId": "uuid",
  "storeId": "uuid",
  "tags": ["tag-uuid-1", "tag-uuid-2"]   // optional
}
```

---

### Events (anonymous analytics)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/events` | No | Record anonymous event (rate limited: 30/min per IP) |

Valid event types: `app_open`, `deal_view`, `store_view`, `geofence_trigger`, `notification_tap`, `video_play`, `city_switch`, `search`, `confirmed_visit`

---

### Upload

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/api/upload` | Yes | Upload image → Cloudinary, returns `{ url, publicId }` |
| POST | `/api/upload/video` | Yes | Upload video → Cloudinary HLS transcode, returns `{ url, hlsUrl, thumbnailUrl, duration, publicId }` |

---

### New Deals (mobile — proximity notifications)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/stores/:id/deals/new?since=` | No | Deals created after `since` ISO timestamp (rate limited: 30/min per IP) |


---

### Tags

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/tags` | No | List all tags (flat with parent/children) |
| POST | `/api/tags` | Yes | Create tag (max 2 levels of nesting) |
| DELETE | `/api/tags/:id` | Yes | Delete tag (`?force=true` to cascade) |

---

### Campaigns

Campaigns are the push notification engine. Create first, send when ready.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/campaigns` | Yes | List all campaigns |
| GET | `/api/campaigns/:id` | Yes | Get campaign detail |
| POST | `/api/campaigns` | Yes | Create campaign |
| POST | `/api/campaigns/:id/send` | Yes | Fire campaign to FCM topic |
| DELETE | `/api/campaigns/:id` | Yes | Delete unsent campaign |

**Campaign types**

| Type | FCM topic | Use case |
|---|---|---|
| `CITY_WIDE` | `city_dakar` | Broadcast to everyone in the city |
| `INTEREST_BASED` | `city_dakar_food` | Target users subscribed to a tag |
| `STORE_SPECIFIC` | `city_dakar` | City-wide push; store filter is metadata for the app |
| `CROSS_CITY` | `city_targetSlug` | Audience in a different city from the store's city |

**Create campaign**
```json
POST /api/campaigns
{
  "title": "Weekend food festival 🍽️",
  "body": "Discover Dakar's best restaurants — special prices all weekend!",
  "type": "INTEREST_BASED",
  "cityId": "uuid",
  "tagSlug": "food",
  "imageUrl": "https://res.cloudinary.com/bizdak/...",  // optional – shown in notification
  "dealIds": ["deal-uuid-1", "deal-uuid-2"]   // optional – linked deals
}
```

**Send campaign**
```json
POST /api/campaigns/:id/send

→ {
  "message": "Campaign sent to topic \"city_dakar_food\".",
  "sentAt": "2025-03-15T10:00:00.000Z"
}
```

Campaigns can only be sent once. A second `send` call returns `409 Conflict`.

**Campaign images:** Add an optional `imageUrl` (Cloudinary HTTPS URL) to show a rich image in the push notification. Works on Android automatically. iOS requires the Notification Service Extension — see `bizdak-mobile/docs/IOS_NOTIFICATION_EXTENSION_SETUP.md`.

---

### Analytics

All analytics are **aggregate only** — no user-level data.

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/analytics/overview?cityId=` | Yes | Total counts + view sums |
| GET | `/api/analytics/top-deals?cityId=&limit=` | Yes | Deals ranked by views |
| GET | `/api/analytics/top-stores?cityId=&limit=` | Yes | Stores ranked by views |
| GET | `/api/analytics/campaigns` | Yes | Campaign send history |

**Overview response**
```json
{
  "stores":    { "total": 12, "totalViews": 3840 },
  "deals":     { "total": 47, "active": 23, "totalViews": 12500 },
  "campaigns": { "total": 8,  "sent": 5 }
}
```

---

## Privacy Architecture

> "Matching is done on-device (proximity) and via topic-based push (interests). The server never knows who received what."

- **No user table** — there are no user records in the database.
- **No location storage** — the server never receives device GPS coordinates.
- **No interest profiles** — FCM topic subscriptions are managed entirely on the device.
- **Topic-based FCM** — the backend publishes to a topic string (`city_dakar_food`). FCM handles fan-out. No per-device targeting.
- **Analytics are aggregate** — `viewCount` is a plain integer counter incremented anonymously. No session or user ID is attached.

---

## Firebase Setup

1. Go to [Firebase Console](https://console.firebase.google.com) → Project Settings → Service accounts
2. Click **Generate new private key** → download JSON
3. Copy values into `.env`:
   - `FIREBASE_PROJECT_ID` → `project_id`
   - `FIREBASE_CLIENT_EMAIL` → `client_email`
   - `FIREBASE_PRIVATE_KEY` → `private_key` (keep `\n` newlines as-is)

Mobile devices subscribe to topics using the FCM client SDK:
```js
// Example (React Native / Flutter)
messaging().subscribeToTopic('city_dakar');
messaging().subscribeToTopic('city_dakar_food');
```

---

## Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use a strong random `JWT_SECRET` (32+ chars)
- [ ] Set `ADMIN_PASSWORD_HASH` to a bcrypt hash and remove `ADMIN_PASSWORD`:
  `node -e "console.log(require('bcryptjs').hashSync('yourpassword', 12))"`
- [ ] Run `npm run db:deploy` (not `db:migrate`) in production
- [ ] Enable PostgreSQL SSL: append `?sslmode=require` to `DATABASE_URL`
- [ ] Set up CORS origin whitelist in `src/app.js`
- [ ] Put API behind a reverse proxy (nginx / Caddy) with HTTPS
- [ ] Set up database backups

---

## License

MIT
