const router = require('express').Router();
const ctrl = require('../batchLotController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/expiring', auth, requireAccess('stok.batchlot', 'hakakses'), ctrl.getExpiringSoon);
router.get('/barang/:idbarang', auth, requireAccess('stok.batchlot', 'hakakses'), ctrl.getByBarang);
router.get('/', auth, requireAccess('stok.batchlot', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('stok.batchlot', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('stok.batchlot', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('stok.batchlot', 'ubah'), ctrl.update);

module.exports = router;
