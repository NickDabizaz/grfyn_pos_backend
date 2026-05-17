const router = require('express').Router();
const ctrl = require('../jualController');
const auth = require('../../../middleware/auth');
const { validateJual } = require('../../../middleware/validateRequest');
const { requireAccess, requireApproveWhenRequested } = require('../../../lib/access');

router.get('/', auth, requireAccess('penjualan.transaksi', 'hakakses'), ctrl.getAll);
router.get('/:id/check-edit', auth, requireAccess('penjualan.transaksi', 'hakakses'), ctrl.checkEdit);
router.get('/:id', auth, requireAccess('penjualan.transaksi', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('penjualan.transaksi', 'tambah'), requireApproveWhenRequested('penjualan.transaksi'), validateJual, ctrl.create);
router.put('/:id/approve', auth, requireAccess('penjualan.transaksi', 'approve'), ctrl.approve);
router.put('/:id/unapprove', auth, requireAccess('penjualan.transaksi', 'batalapprove'), ctrl.unapprove);
router.put('/:id/cancel', auth, requireAccess('penjualan.transaksi', 'bataltransaksi'), ctrl.cancel);
router.put('/:id', auth, requireAccess('penjualan.transaksi', 'ubah'), requireApproveWhenRequested('penjualan.transaksi'), validateJual, ctrl.update);

module.exports = router;
