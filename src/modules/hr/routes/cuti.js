const router = require('express').Router();
const ctrl = require('../cutiController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/saldo/:idkaryawan', auth, requireAccess('sdm.cuti', 'hakakses'), ctrl.getSaldoCuti);
router.get('/', auth, requireAccess('sdm.cuti', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('sdm.cuti', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('sdm.cuti', 'tambah'), ctrl.create);
router.put('/:id/approve', auth, requireAccess('sdm.cuti', 'approve'), ctrl.approve);
router.put('/:id/reject', auth, requireAccess('sdm.cuti', 'approve'), ctrl.reject);
router.delete('/:id', auth, requireAccess('sdm.cuti', 'tambah'), ctrl.remove);

module.exports = router;
