const router = require('express').Router();
const ctrl = require('../supplierController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('master.supplier', 'hakakses'), ctrl.getAll);
router.post('/', auth, requireAccess('master.supplier', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('master.supplier', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('master.supplier', 'tambah'), ctrl.remove);

module.exports = router;
