const router = require('express').Router();
const ctrl   = require('../diskonController');
const auth   = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/',       auth, requireAccess('penjualan.diskon', 'hakakses'), ctrl.getAll);
router.get('/aktif',  auth, requireAccess('penjualan.diskon', 'hakakses'), ctrl.getAktif);
router.get('/:id',    auth, requireAccess('penjualan.diskon', 'hakakses'), ctrl.getOne);
router.post('/',      auth, requireAccess('penjualan.diskon', 'tambah'),   ctrl.create);
router.put('/:id',    auth, requireAccess('penjualan.diskon', 'ubah'),     ctrl.update);
router.delete('/:id', auth, requireAccess('penjualan.diskon', 'tambah'),   ctrl.remove);

module.exports = router;
