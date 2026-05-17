const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const ctrl = require('../transferstokController');

router.use(auth);

router.get('/', requireAccess('stok.transferstok', 'hakakses'), ctrl.getAll);
router.get('/:id', requireAccess('stok.transferstok', 'hakakses'), ctrl.getOne);
router.post('/', requireAccess('stok.transferstok', 'tambah'), ctrl.create);
router.put('/:id/kirim', requireAccess('stok.transferstok', 'ubah'), ctrl.kirim);
router.put('/:id/terima', requireAccess('stok.transferstok', 'ubah'), ctrl.terima);
router.put('/:id/batal', requireAccess('stok.transferstok', 'ubah'), ctrl.batal);

module.exports = router;
