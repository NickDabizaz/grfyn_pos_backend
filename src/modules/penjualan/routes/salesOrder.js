const router = require('express').Router();
const ctrl = require('../salesOrderController');
const auth = require('../../../middleware/auth');
const { requireAccess, requireApproveWhenRequested } = require('../../../lib/access');

router.get('/', auth, requireAccess('penjualan.so', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('penjualan.so', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('penjualan.so', 'tambah'), requireApproveWhenRequested('penjualan.so'), ctrl.create);
router.put('/:id/approve', auth, requireAccess('penjualan.so', 'approve'), ctrl.approve);
router.put('/:id/unapprove', auth, requireAccess('penjualan.so', 'batalapprove'), ctrl.unapprove);
router.put('/:id/batal', auth, requireAccess('penjualan.so', 'bataltransaksi'), ctrl.batal);
router.put('/:id', auth, requireAccess('penjualan.so', 'ubah'), requireApproveWhenRequested('penjualan.so'), ctrl.update);

module.exports = router;
