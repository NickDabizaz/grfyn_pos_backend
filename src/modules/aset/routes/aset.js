const router = require('express').Router();
const ctrl = require('../asetController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/kategori', auth, requireAccess('aset.tetap', 'hakakses'), ctrl.getKategori);
router.post('/hitung-penyusutan-bulk', auth, requireAccess('aset.tetap', 'approve'), ctrl.bulkHitungPenyusutan);
router.get('/', auth, requireAccess('aset.tetap', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('aset.tetap', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('aset.tetap', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('aset.tetap', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('aset.tetap', 'tambah'), ctrl.remove);
router.post('/:id/hitung-penyusutan', auth, requireAccess('aset.tetap', 'approve'), ctrl.hitungPenyusutan);

module.exports = router;
