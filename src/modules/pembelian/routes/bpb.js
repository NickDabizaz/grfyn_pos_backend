const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { requireAccess, requireApproveWhenRequested } = require('../../../lib/access');
const { requireTransactionQuota } = require('../../../middleware/subscription');
const ctrl = require('../bpbController');

router.use(auth);

router.get('/', requireAccess('pembelian.bpb', 'hakakses'), ctrl.getAll);
router.get('/:id', requireAccess('pembelian.bpb', 'hakakses'), ctrl.getOne);
router.post('/', requireAccess('pembelian.bpb', 'tambah'), requireTransactionQuota(), requireApproveWhenRequested('pembelian.bpb'), ctrl.create);
router.put('/:id/approve', requireAccess('pembelian.bpb', 'approve'), ctrl.approve);
router.put('/:id/unapprove', requireAccess('pembelian.bpb', 'batalapprove'), ctrl.unapprove);
router.put('/:id/batal', requireAccess('pembelian.bpb', 'bataltransaksi'), ctrl.batal);
router.put('/:id', requireAccess('pembelian.bpb', 'ubah'), requireApproveWhenRequested('pembelian.bpb'), ctrl.update);

module.exports = router;
