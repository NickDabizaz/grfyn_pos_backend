const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const ctrl = require('../karyawanController');

router.use(auth);

router.get('/', requireAccess('sdm.karyawan', 'hakakses'), ctrl.getAll);
router.get('/:id', requireAccess('sdm.karyawan', 'hakakses'), ctrl.getOne);
router.post('/', requireAccess('sdm.karyawan', 'tambah'), ctrl.create);
router.put('/:id', requireAccess('sdm.karyawan', 'ubah'), ctrl.update);
router.delete('/:id', requireAccess('sdm.karyawan', 'tambah'), ctrl.remove);
router.get('/:id/komponen', requireAccess('sdm.karyawan', 'hakakses'), ctrl.getKomponenGaji);
router.post('/:id/komponen', requireAccess('sdm.karyawan', 'tambah'), ctrl.setKomponenGaji);

module.exports = router;
