const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

const fileFilter = (req, file, cb) => {
  const filetypes = /jpeg|jpg|png|gif/;
  const extname = filetypes.test(path.extname(file.originalname).toLowerCase());
  const mimetype = filetypes.test(file.mimetype) || file.mimetype.startsWith('image/');

  console.log('File details:', { originalname: file.originalname, mimetype: file.mimetype, extname, mimetypeCheck: filetypes.test(file.mimetype) });

  if (extname || mimetype) {
    cb(null, true);
  } else {
    cb(new Error('Only images are allowed!'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 },
}).fields([
  { name: 'thumbnails', maxCount: 2 },
  { name: 'gallery', maxCount: 5 },
  { name: 'bannerImage', maxCount: 1 },
]);

module.exports = upload;