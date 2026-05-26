const router = require('express').Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const ctrl = require('../barangController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

const uploadDir = path.join(__dirname, '..', '..', '..', '..', 'uploads', 'barang');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `barang-${req.params.id}-${Date.now()}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
  if (/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) cb(null, true);
  else cb(new Error('Hanya file gambar (jpg, png, webp, gif) yang diizinkan'));
}});

router.get('/', auth, requireAccess('master.barang', 'hakakses'), ctrl.getAll);
router.get('/browse-barang', auth, ctrl.browseBarang);
router.get('/check-price', auth, ctrl.checkPrice);
router.get('/:id', auth, requireAccess('master.barang', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('master.barang', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('master.barang', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('master.barang', 'tambah'), ctrl.remove);
router.get('/:id/hargabeli', auth, requireAccess('master.barang', 'hakakses'), ctrl.getHargaBeli);
router.get('/:id/hargajual', auth, requireAccess('master.barang', 'hakakses'), ctrl.getHargaJual);
router.post('/:id/foto', auth, requireAccess('master.barang', 'ubah'), upload.single('foto'), ctrl.uploadFoto);

module.exports = router;
