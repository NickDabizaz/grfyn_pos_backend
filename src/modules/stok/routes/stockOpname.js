const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const ctrl = require('../stockOpnameController');

router.use(auth);

router.get('/', requireAccess('stok.stockopname', 'hakakses'), ctrl.getAll);
router.post('/', requireAccess('stok.stockopname', 'tambah'), ctrl.create);
router.get('/:id', requireAccess('stok.stockopname', 'hakakses'), ctrl.getOne);
router.put('/:id/fisik', requireAccess('stok.stockopname', 'ubah'), ctrl.updateFisik);
router.put('/:id/finalize', requireAccess('stok.stockopname', 'ubah'), ctrl.finalize);

module.exports = router;
