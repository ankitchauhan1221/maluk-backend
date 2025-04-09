const express = require('express');
const router = express.Router();
const {
  getAllBanners,
  addBanner,
  updateBanner,
  deleteBanner,
  toggleBannerActive,
} = require('../controllers/bannerController');
const { authMiddleware, adminMiddleware } = require('../middleware/authMiddleware');
const upload = require('../middleware/multer');



router.get('/', getAllBanners);
router.post('/', upload, addBanner, adminMiddleware, authMiddleware);
router.put('/:id', upload, updateBanner,adminMiddleware, authMiddleware);
router.delete('/:id', deleteBanner, adminMiddleware, authMiddleware);
router.patch('/:id/toggle', toggleBannerActive, adminMiddleware, authMiddleware);

module.exports = router;