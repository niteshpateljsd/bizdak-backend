const router = require('express').Router();
const { authenticate } = require('../middleware/auth.middleware');
const { uploadImage, uploadVideo } = require('../utils/cloudinary');
const { uploadImage: handleImage, uploadVideoFile: handleVideo } = require('../controllers/upload.controller');

function setFolder(req, res, next) {
  req.uploadFolder = req.query.type === 'deal'
    ? 'bizdak/deals'
    : req.query.type === 'store'
      ? 'bizdak/stores'
      : 'bizdak';
  next();
}

function setVideoFolder(req, res, next) {
  req.uploadFolder = req.query.type === 'deal'
    ? 'bizdak/videos/deals'
    : req.query.type === 'store'
      ? 'bizdak/videos/stores'
      : 'bizdak/videos';
  next();
}

// POST /api/upload?type=deal|store  — image upload
router.post('/', authenticate, setFolder, uploadImage.single('image'), handleImage);

// POST /api/upload/video?type=deal|store  — video upload
router.post('/video', authenticate, setVideoFolder, uploadVideo.single('video'), handleVideo);

module.exports = router;
