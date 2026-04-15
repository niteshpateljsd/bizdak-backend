const admin = require('firebase-admin');

let app;

function getFirebaseApp() {
  if (!app) {
    app = admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
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
  const base = `city_${citySlug}`;
  return tagSlug ? `${base}_${tagSlug}` : base;
}

/**
 * Send a push notification to an FCM topic.
 * No user identity is involved — topic-based only.
 */
async function sendToTopic(topic, { title, body, data = {} }) {
  getFirebaseApp();

  const message = {
    notification: { title, body },
    data: {
      ...data,
      // Ensure all data values are strings (FCM requirement)
      ...Object.fromEntries(
        Object.entries(data).map(([k, v]) => [k, String(v)])
      ),
    },
    topic,
    android: {
      priority: 'high',
      notification: { sound: 'default' },
    },
    apns: {
      payload: {
        aps: { sound: 'default', badge: 1 },
      },
    },
  };

  const response = await admin.messaging().send(message);
  return response;
}

module.exports = { buildTopic, sendToTopic };
