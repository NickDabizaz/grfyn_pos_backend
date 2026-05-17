const router = require('express').Router();
const ctrl = require('../pelunasanpiutangController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('keuangan.pelunasanpiutang', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('keuangan.pelunasanpiutang', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('keuangan.pelunasanpiutang', 'tambah'), ctrl.create);
router.delete('/:id', auth, requireAccess('keuangan.pelunasanpiutang', 'tambah'), ctrl.remove);

module.exports = router;