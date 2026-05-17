const router = require('express').Router();
const ctrl = require('../settingController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '..', '..', 'uploads'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `logo_${Date.now()}${ext}`);
  }
});

const upload = multer({ storage });

router.get('/toko', auth, requireAccess('pos', 'hakakses'), ctrl.getToko);
router.put('/toko', auth, requireAccess('pos', 'ubah'), ctrl.updateToko);
router.put('/logo', auth, requireAccess('pos', 'ubah'), upload.single('logo'), ctrl.updateLogo);

module.exports = router;
