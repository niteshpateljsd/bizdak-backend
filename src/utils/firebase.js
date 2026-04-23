const admin = require('firebase-admin');

let app;

function getFirebaseApp() {
  if (!app) {
    const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
      throw new Error('[Firebase] Missing required env vars: FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL');
    }
    // getApps() checks if the default app already exists — prevents
    // 'Firebase App named [DEFAULT] already exists' on hot-reload / server restart
    const existing = admin.apps.find((a) => a.name === '[DEFAULT]');
    app = existing || admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   FIREBASE_PROJECT_ID,
        privateKey:  FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        clientEmail: FIREBASE_CLIENT_EMAIL,
      }),
    });
  }
  return app;
}

/**
 * Build the FCM topic string for a given city and optional tag.
 * Examples:
 *   buildTopic('dakar')            → 'city_dakar'
 *   buildTopic('dakar', 'food')    → 'city_dakar_food'
 */
function buildTopic(citySlug, tagSlug = null) {
  // Normalise to lowercase — FCM topics are case-sensitive, slugs must match mobile subscriptions
  const base = `city_${citySlug?.toLowerCase()}`;
  return tagSlug ? `${base}_${tagSlug?.toLowerCase()}` : base;
}

/**
 * Send a push notification to an FCM topic.
 * No user identity is involved — topic-based only.
 */
async function sendToTopic(topic, { title, body, imageUrl = null, data = {} }) {
  getFirebaseApp();

  const message = {
    notification: {
      title,
      body,
      // imageUrl in notification block: shown natively on Android 12+
      ...(imageUrl ? { imageUrl } : {}),
    },
    // FCM requires all data values to be non-null strings
    data: Object.fromEntries(
      Object.entries(data)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)])
    ),
    topic,
    android: {
      priority: 'high',
      notification: {
        sound:     'default',
        channelId: 'bizdak-campaigns', // high-importance channel with image support
        // Large image on Android — shown in expanded notification shade
        ...(imageUrl ? {
          imageUrl,
        } : {}),
      },
    },
    apns: {
      payload: {
        aps: {
          sound:           'default',
          badge:           1,
          // mutable-content: 1 tells iOS to wake the Notification Service Extension
          // so it can download and attach the image before displaying the notification
          'mutable-content': imageUrl ? 1 : 0,
        },
      },
      fcmOptions: {
        // FCM passes this to APNS — Extension reads from notification.userInfo.imageUrl
        ...(imageUrl ? { imageUrl } : {}),
      },
    },
  };

  const response = await admin.messaging().send(message);
  return response;
}

module.exports = { buildTopic, sendToTopic };
