const router = require('express').Router();
const ctrl = require('../akunController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/', auth, requireAccess('master.akun', 'hakakses'), ctrl.getAll);
// Setting akun default jurnal — harus didaftarkan sebelum route '/:id'
router.get('/setting-jurnal', auth, requireAccess('master.akun', 'hakakses'), ctrl.getSettingJurnal);
router.put('/setting-jurnal', auth, requireAccess('master.akun', 'ubah'), ctrl.saveSettingJurnal);
router.get('/:id', auth, requireAccess('master.akun', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('master.akun', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('master.akun', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('master.akun', 'tambah'), ctrl.remove);

module.exports = router;
