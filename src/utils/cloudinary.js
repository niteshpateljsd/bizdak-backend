const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.warn('[Cloudinary] Missing env vars — image/video uploads will fail. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.');
}

cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME,
  api_key:    CLOUDINARY_API_KEY,
  api_secret: CLOUDINARY_API_SECRET,
});

// ── Image storage ─────────────────────────────────────────────
const imageStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder:          req.uploadFolder || 'bizdak',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'gif'],
    transformation: [
      { width: 1200, height: 800, crop: 'limit' },
      { quality: 'auto:good' },
      { fetch_format: 'auto' },
      { angle: 'exif' },   // auto-rotate based on EXIF orientation (phone photos)
    ],
  }),
});

// ── Video storage ─────────────────────────────────────────────
// Cloudinary transcodes to HLS automatically.
// eager transformations generate the HLS playlist on upload
// so the first playback request is instant.
const videoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req) => ({
    folder:           req.uploadFolder || 'bizdak/videos',
    resource_type:    'video',
    allowed_formats:  ['mp4', 'mov', 'avi', 'mkv', 'webm'],
    // Adaptive streaming — generates HLS on upload
    eager: [
      { streaming_profile: 'hd',   format: 'm3u8' }, // HLS HD
      { streaming_profile: 'full_hd', format: 'm3u8' }, // HLS Full HD
    ],
    eager_async: false,  // synchronous — HLS ready in response; duration available immediately
    // Note: upload response takes longer (Cloudinary transcodes before responding)
    // but this is the only way to get videoDuration without implementing webhooks.
    // Generate a thumbnail at 0.5s for use as poster frame
    transformation: [
      { quality: 'auto:good' },
      { fetch_format: 'auto' },
    ],
  }),
});

// Max 500MB for video (covers a 5-min 1080p tour at reasonable bitrate)
const uploadImage = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed.'));
    }
    // HEIC/HEIF (iPhone native format) is not supported by Cloudinary on free tier
    // Reject early with a clear message rather than letting Cloudinary fail silently
    if (file.mimetype === 'image/heic' || file.mimetype === 'image/heif' ||
        file.originalname?.toLowerCase().endsWith('.heic') ||
        file.originalname?.toLowerCase().endsWith('.heif')) {
      return cb(new Error('HEIC/HEIF images are not supported. Please convert to JPEG or PNG first.'));
    }
    cb(null, true);
  },
});

const uploadVideo = multer({
  storage: videoStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('video/')) {
      return cb(new Error('Only video files are allowed.'));
    }
    cb(null, true);
  },
});

/**
 * Get the HLS streaming URL for a Cloudinary video.
 * Cloudinary generates this from the public_id after transcoding.
 */
function getHLSUrl(publicId) {
  return cloudinary.url(publicId, {
    resource_type:   'video',
    format:          'm3u8',
    streaming_profile: 'hd',
  });
}

/**
 * Get a video thumbnail (poster frame) at a given time offset.
 * Default: 0.5s into the video.
 */
function getVideoThumbnail(publicId, offset = '0.5') {
  return cloudinary.url(publicId, {
    resource_type: 'video',
    format:        'jpg',
    transformation: [
      { start_offset: offset },
      { width: 800, crop: 'scale' },
      { quality: 'auto:good' },
    ],
  });
}

async function deleteAsset(publicId, resourceType = 'image') {
  if (!publicId) return;
  try {
    await cloudinary.uploader.destroy(publicId, { resource_type: resourceType });
  } catch (err) {
    console.warn('[Cloudinary] Delete failed:', err.message);
  }
}

function extractPublicId(url) {
  if (!url) return null;
  try {
    const parts = url.split('/upload/');
    if (parts.length < 2) return null;
    let path = parts[1];

    // Strip Cloudinary transformation segments from the start of the path.
    // Transformation segments contain commas (e.g. w_1200,f_auto,q_auto) and
    // are separated from the asset path by a forward slash.
    // We must strip these before extracting the publicId, otherwise deleteAsset()
    // passes an invalid publicId and the Cloudinary asset leaks (never deleted).
    //
    // Examples:
    //   w_1200,f_auto,q_auto/bizdak/stores/abc  → bizdak/stores/abc
    //   v1234567890/bizdak/deals/xyz             → bizdak/deals/xyz
    //   bizdak/stores/abc                        → bizdak/stores/abc (unchanged)
    //
    // Strategy: split on '/', drop any leading segment that looks like a
    // transformation (contains a comma) or a version token (v + digits only).
    const segments = path.split('/');
    while (segments.length > 1) {
      const first = segments[0];
      const isTransformation = first.includes(',');          // e.g. w_1200,f_auto
      const isVersion        = /^v\d+$/.test(first);        // e.g. v1234567890
      if (isTransformation || isVersion) {
        segments.shift();
      } else {
        break;
      }
    }
    path = segments.join('/');

    // Strip file extension (.jpg, .png, .webp, .mp4, etc.)
    path = path.replace(/\.[^.]+$/, '');
    return path || null;
  } catch { return null; }
}

module.exports = {
  upload: uploadImage,   // backward-compatible name
  uploadImage,
  uploadVideo,
  getHLSUrl,
  getVideoThumbnail,
  deleteAsset,
  extractPublicId,
};
