const router = require('express').Router();
const ctrl   = require('../diskonController');
const auth   = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/',       auth, requireAccess('master.promo', 'hakakses'), ctrl.getAll);
router.get('/aktif',  auth, requireAccess('master.promo', 'hakakses'), ctrl.getAktif);
router.get('/:id',    auth, requireAccess('master.promo', 'hakakses'), ctrl.getOne);
router.post('/',      auth, requireAccess('master.promo', 'tambah'),   ctrl.create);
router.put('/:id',    auth, requireAccess('master.promo', 'ubah'),     ctrl.update);
router.delete('/:id', auth, requireAccess('master.promo', 'tambah'),   ctrl.remove);

module.exports = router;
