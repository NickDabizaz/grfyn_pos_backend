const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const ctrl = require('../absensiController');

router.use(auth);

router.get('/rekap', requireAccess('sdm.absensi', 'hakakses'), ctrl.rekapBulanan);
router.get('/', requireAccess('sdm.absensi', 'hakakses'), ctrl.getAll);
router.post('/', requireAccess('sdm.absensi', 'tambah'), ctrl.create);
router.put('/:id', requireAccess('sdm.absensi', 'ubah'), ctrl.update);

module.exports = router;
