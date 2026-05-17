const router = require('express').Router();
const ctrl = require('../kasController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('keuangan.kas', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('keuangan.kas', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('keuangan.kas', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('keuangan.kas', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('keuangan.kas', 'tambah'), ctrl.remove);

module.exports = router;
