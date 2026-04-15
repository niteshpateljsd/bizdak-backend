const { getHLSUrl, getVideoThumbnail, extractPublicId } = require('../utils/cloudinary');

/**
 * POST /api/upload?type=deal|store
 * Accepts: multipart/form-data, field name "image"
 * Returns: { url, publicId }
 */
async function uploadImage(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided.' });
    const { path: url, filename: publicId } = req.file;
    res.status(201).json({ url, publicId });
  } catch (err) { next(err); }
}

/**
 * POST /api/upload/video?type=deal|store
 * Accepts: multipart/form-data, field name "video"
 * Returns: { url, hlsUrl, thumbnailUrl, publicId, duration }
 *
 * url       — original MP4 URL (fallback for non-HLS players)
 * hlsUrl    — HLS adaptive stream (use this for playback)
 * thumbnail — poster frame at 0.5s
 *
 * Note: HLS transcoding is async on Cloudinary's side.
 * The hlsUrl is pre-computed but may take 30–120s to be ready
 * after upload depending on video length. The mobile player
 * should fall back to the direct url if HLS isn't ready yet.
 */
async function uploadVideoFile(req, res, next) {
  try {
    if (!req.file) return res.status(400).json({ error: 'No video file provided.' });

    const { path: url, filename: publicId } = req.file;

    // Derive HLS and thumbnail URLs from the publicId
    const hlsUrl      = getHLSUrl(publicId);
    const thumbnailUrl = getVideoThumbnail(publicId, '0.5');

    res.status(201).json({
      url,           // direct mp4
      hlsUrl,        // adaptive HLS stream (preferred)
      thumbnailUrl,  // poster frame
      publicId,
    });
  } catch (err) { next(err); }
}

module.exports = { uploadImage, uploadVideoFile };
