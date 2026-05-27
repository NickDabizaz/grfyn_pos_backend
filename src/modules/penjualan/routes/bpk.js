const router = require('express').Router();
const ctrl = require('../bpkController');
const auth = require('../../../middleware/auth');
const { requireAccess, requireApproveWhenRequested } = require('../../../lib/access');
const { requireTransactionQuota } = require('../../../middleware/subscription');

router.get('/', auth, requireAccess('penjualan.bpk', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('penjualan.bpk', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('penjualan.bpk', 'tambah'), requireTransactionQuota(), requireApproveWhenRequested('penjualan.bpk'), ctrl.create);
router.put('/:id/approve', auth, requireAccess('penjualan.bpk', 'approve'), ctrl.approve);
router.put('/:id/unapprove', auth, requireAccess('penjualan.bpk', 'batalapprove'), ctrl.unapprove);
router.put('/:id/batal', auth, requireAccess('penjualan.bpk', 'bataltransaksi'), ctrl.batal);
router.put('/:id', auth, requireAccess('penjualan.bpk', 'ubah'), requireApproveWhenRequested('penjualan.bpk'), ctrl.update);

module.exports = router;
