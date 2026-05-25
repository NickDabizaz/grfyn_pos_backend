const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const { requireTransactionQuota } = require('../../../middleware/subscription');
const ctrl = require('../absensiController');

router.use(auth);

router.get('/rekap', requireAccess('sdm.absensi', 'hakakses'), ctrl.rekapBulanan);
router.get('/', requireAccess('sdm.absensi', 'hakakses'), ctrl.getAll);
router.post('/', requireAccess('sdm.absensi', 'tambah'), requireTransactionQuota(), ctrl.create);
router.put('/:id', requireAccess('sdm.absensi', 'ubah'), ctrl.update);
router.delete('/:id', requireAccess('sdm.absensi', 'ubah'), ctrl.remove);

module.exports = router;
