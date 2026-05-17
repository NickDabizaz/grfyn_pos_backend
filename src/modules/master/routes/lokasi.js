const router = require('express').Router();
const ctrl = require('../lokasiController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('master.lokasi', 'hakakses'), ctrl.getAll);
router.post('/', auth, requireAccess('master.lokasi', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('master.lokasi', 'ubah'), ctrl.update);

module.exports = router;
