const router = require('express').Router();
const ctrl = require('../customerController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('master.customer', 'hakakses'), ctrl.getAll);
router.post('/', auth, requireAccess('master.customer', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('master.customer', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('master.customer', 'tambah'), ctrl.remove);

module.exports = router;
