const router = require('express').Router();
const ctrl = require('../beliController');
const auth = require('../../../middleware/auth');
const { validateBeli } = require('../../../middleware/validateRequest');
const { requireAccess, requireApproveWhenRequested } = require('../../../lib/access');

router.get('/', auth, requireAccess('pembelian.transaksi', 'hakakses'), ctrl.getAll);
router.get('/:id/check-edit', auth, requireAccess('pembelian.transaksi', 'hakakses'), ctrl.checkEdit);
router.get('/:id', auth, requireAccess('pembelian.transaksi', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('pembelian.transaksi', 'tambah'), requireApproveWhenRequested('pembelian.transaksi'), validateBeli, ctrl.create);
router.put('/:id/approve', auth, requireAccess('pembelian.transaksi', 'approve'), ctrl.approve);
router.put('/:id/unapprove', auth, requireAccess('pembelian.transaksi', 'batalapprove'), ctrl.unapprove);
router.put('/:id/cancel', auth, requireAccess('pembelian.transaksi', 'bataltransaksi'), ctrl.cancel);
router.put('/:id', auth, requireAccess('pembelian.transaksi', 'ubah'), requireApproveWhenRequested('pembelian.transaksi'), validateBeli, ctrl.update);

module.exports = router;
