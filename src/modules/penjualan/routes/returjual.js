const router = require('express').Router();
const ctrl = require('../returjualController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const { validateReturJual } = require('../../../middleware/validateRequest');

router.get('/', auth, requireAccess('penjualan.retur', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('penjualan.retur', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('penjualan.retur', 'tambah'), validateReturJual, ctrl.create);
router.put('/:id/approve', auth, requireAccess('penjualan.retur', 'ubah'), ctrl.approve);
router.put('/:id/unapprove', auth, requireAccess('penjualan.retur', 'ubah'), ctrl.unapprove);
router.put('/:id/cancel', auth, requireAccess('penjualan.retur', 'ubah'), ctrl.cancel);
router.put('/:id', auth, requireAccess('penjualan.retur', 'ubah'), validateReturJual, ctrl.update);

module.exports = router;
