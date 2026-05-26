const router = require('express').Router();
const ctrl = require('../lemburController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/rekap', auth, requireAccess('sdm.lembur', 'hakakses'), ctrl.getRekapLembur);
router.get('/', auth, requireAccess('sdm.lembur', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('sdm.lembur', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('sdm.lembur', 'tambah'), ctrl.create);
router.put('/:id/approve', auth, requireAccess('sdm.lembur', 'approve'), ctrl.approve);
router.delete('/:id', auth, requireAccess('sdm.lembur', 'tambah'), ctrl.remove);

module.exports = router;
