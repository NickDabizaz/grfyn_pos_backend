const router = require('express').Router();
const ctrl = require('../returbeliController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const { validateReturBeli } = require('../../../middleware/validateRequest');

router.get('/', auth, requireAccess('pembelian.retur', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('pembelian.retur', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('pembelian.retur', 'tambah'), validateReturBeli, ctrl.create);
router.put('/:id/approve', auth, requireAccess('pembelian.retur', 'ubah'), ctrl.approve);
router.put('/:id', auth, requireAccess('pembelian.retur', 'ubah'), validateReturBeli, ctrl.update);
router.put('/:id/unapprove', auth, requireAccess('pembelian.retur', 'ubah'), ctrl.unapprove);
router.put('/:id/cancel', auth, requireAccess('pembelian.retur', 'ubah'), ctrl.cancel);

module.exports = router;
