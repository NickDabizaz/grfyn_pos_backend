const router = require('express').Router();
const ctrl = require('../barangController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('master.barang', 'hakakses'), ctrl.getAll);
router.get('/browse-barang', auth, ctrl.browseBarang);
router.get('/check-price', auth, ctrl.checkPrice);
router.get('/:id', auth, requireAccess('master.barang', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('master.barang', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('master.barang', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('master.barang', 'tambah'), ctrl.remove);
router.get('/:id/hargabeli', auth, requireAccess('master.barang', 'hakakses'), ctrl.getHargaBeli);
router.get('/:id/hargajual', auth, requireAccess('master.barang', 'hakakses'), ctrl.getHargaJual);

module.exports = router;
