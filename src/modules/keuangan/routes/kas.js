const router = require('express').Router();
const ctrl = require('../kasController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('keuangan.kas', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('keuangan.kas', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('keuangan.kas', 'tambah'), ctrl.create);
router.put('/:id/approve', auth, requireAccess('keuangan.kas', 'approve'), ctrl.approve);
router.put('/:id/unapprove', auth, requireAccess('keuangan.kas', 'batalapprove'), ctrl.unapprove);
router.put('/:id/cancel', auth, requireAccess('keuangan.kas', 'bataltransaksi'), ctrl.cancel);
router.put('/:id', auth, requireAccess('keuangan.kas', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('keuangan.kas', 'tambah'), ctrl.remove);

module.exports = router;
