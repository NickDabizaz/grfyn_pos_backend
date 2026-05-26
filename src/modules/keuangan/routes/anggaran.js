const router = require('express').Router();
const ctrl = require('../anggaranController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/:id/realisasi', auth, requireAccess('keuangan.anggaran', 'hakakses'), ctrl.getRealisasi);
router.post('/:id/sync-realisasi', auth, requireAccess('keuangan.anggaran', 'approve'), ctrl.syncRealisasi);
router.put('/:id/approve', auth, requireAccess('keuangan.anggaran', 'approve'), ctrl.approve);
router.get('/', auth, requireAccess('keuangan.anggaran', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('keuangan.anggaran', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('keuangan.anggaran', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('keuangan.anggaran', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('keuangan.anggaran', 'tambah'), ctrl.remove);

module.exports = router;
