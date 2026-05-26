const router = require('express').Router();
const ctrl   = require('../hargaLevelController');
const auth   = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/',                    auth, requireAccess('master.hargalevel', 'hakakses'), ctrl.getAll);
router.get('/barang/:idbarang',    auth, requireAccess('master.hargalevel', 'hakakses'), ctrl.getBarangPrice);
router.post('/apply-customer',     auth, requireAccess('master.hargalevel', 'ubah'),     ctrl.applyToCustomer);
router.get('/:id',                 auth, requireAccess('master.hargalevel', 'hakakses'), ctrl.getOne);
router.post('/',                   auth, requireAccess('master.hargalevel', 'tambah'),   ctrl.create);
router.put('/:id',                 auth, requireAccess('master.hargalevel', 'ubah'),     ctrl.update);
router.delete('/:id',              auth, requireAccess('master.hargalevel', 'tambah'),   ctrl.remove);

module.exports = router;
