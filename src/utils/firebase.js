const admin = require('firebase-admin');

let app;

function getFirebaseApp() {
  if (!app) {
    const { FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL } = process.env;
    if (!FIREBASE_PROJECT_ID || !FIREBASE_PRIVATE_KEY || !FIREBASE_CLIENT_EMAIL) {
      throw new Error('[Firebase] Missing required env vars: FIREBASE_PROJECT_ID, FIREBASE_PRIVATE_KEY, FIREBASE_CLIENT_EMAIL');
    }
    app = admin.initializeApp({
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
 *
 * imageUrl (optional): shown as a rich notification image.
 *   Android 12+: notification.image
 *   iOS:         apns.fcm_options.image (requires mutable-content: 1)
 */
async function sendToTopic(topic, { title, body, imageUrl = null, data = {} }) {
  getFirebaseApp();

  const message = {
    notification: {
      title,
      body,
      // Android 12+ shows this as the rich notification image
      ...(imageUrl ? { image: imageUrl } : {}),
    },
    // FCM requires all data values to be strings
    data: Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, String(v)])
    ),
    topic,
    android: {
      priority: 'high',
      notification: {
        sound: 'default',
        // channelId must match the channel created in App.js
        // (Notifications.setNotificationChannelAsync 'bizdak-campaigns').
        // Without this, Android 8+ silently uses the default channel which
        // may not have HIGH importance — preventing heads-up notifications.
        channelId: 'bizdak-campaigns',
        // imageUrl passed here too for older Android Firebase SDK compatibility
        ...(imageUrl ? { imageUrl } : {}),
      },
    },
    apns: {
      payload: {
        aps: {
          sound: 'default',
          badge: 1,
          // mutable-content: 1 allows the iOS notification service extension
          // to download and attach the image before display
          'mutable-content': imageUrl ? 1 : 0,
        },
      },
      // fcm_options.image is the correct FCM field for iOS notification images
      ...(imageUrl ? { fcm_options: { image: imageUrl } } : {}),
    },
  };

  const response = await admin.messaging().send(message);
  return response;
}

module.exports = { buildTopic, sendToTopic };
