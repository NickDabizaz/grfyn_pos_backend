const router = require('express').Router();
const ctrl = require('../pelunasanhutangController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('keuangan.pelunasanhutang', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('keuangan.pelunasanhutang', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('keuangan.pelunasanhutang', 'tambah'), ctrl.create);
router.delete('/:id', auth, requireAccess('keuangan.pelunasanhutang', 'tambah'), ctrl.remove);

module.exports = router;