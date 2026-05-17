const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { requireAccess, requireApproveWhenRequested } = require('../../../lib/access');
const ctrl = require('../purchaseOrderController');

router.use(auth);

router.get('/', requireAccess('pembelian.po', 'hakakses'), ctrl.getAll);
router.get('/:id', requireAccess('pembelian.po', 'hakakses'), ctrl.getOne);
router.post('/', requireAccess('pembelian.po', 'tambah'), requireApproveWhenRequested('pembelian.po'), ctrl.create);
router.put('/:id/approve', requireAccess('pembelian.po', 'approve'), ctrl.approve);
router.put('/:id/unapprove', requireAccess('pembelian.po', 'batalapprove'), ctrl.unapprove);
router.put('/:id/batal', requireAccess('pembelian.po', 'bataltransaksi'), ctrl.batal);
router.put('/:id', requireAccess('pembelian.po', 'ubah'), requireApproveWhenRequested('pembelian.po'), ctrl.update);

module.exports = router;
