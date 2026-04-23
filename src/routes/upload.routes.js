const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { uploadImage, uploadVideo } = require('../utils/cloudinary');
const { uploadImage: handleImage, uploadVideoFile: handleVideo } = require('../controllers/upload.controller');

const ALLOWED_TYPES = ['deal', 'store'];

function setFolder(req, res, next) {
  const type = req.query.type;
  if (type && !ALLOWED_TYPES.includes(type)) {
    return res.status(422).json({ error: "?type must be 'deal' or 'store'" });
  }
  req.uploadFolder = type === 'deal' ? 'bizdak/deals' : type === 'store' ? 'bizdak/stores' : 'bizdak';
  next();
}

function setVideoFolder(req, res, next) {
  const type = req.query.type;
  if (type && !ALLOWED_TYPES.includes(type)) {
    return res.status(422).json({ error: "?type must be 'deal' or 'store'" });
  }
  req.uploadFolder = type === 'deal' ? 'bizdak/videos/deals' : type === 'store' ? 'bizdak/videos/stores' : 'bizdak/videos';
  next();
}

// POST /api/upload?type=deal|store  — image upload
router.post('/', authenticate, setFolder, uploadImage.single('image'), handleImage);

// POST /api/upload/video?type=deal|store  — video upload
router.post('/video', authenticate, setVideoFolder, uploadVideo.single('video'), handleVideo);

module.exports = router;
