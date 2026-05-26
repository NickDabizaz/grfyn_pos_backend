const router = require('express').Router();
const ctrl = require('../poinController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/setting', auth, requireAccess('master.poin', 'hakakses'), ctrl.getSetting);
router.post('/setting', auth, requireAccess('master.poin', 'ubah'), ctrl.saveSetting);
router.get('/customer', auth, requireAccess('master.poin', 'hakakses'), ctrl.getAllCustomerPoin);
router.get('/customer/:idcustomer', auth, requireAccess('master.poin', 'hakakses'), ctrl.getCustomerPoin);
router.post('/tambah', auth, requireAccess('master.poin', 'tambah'), ctrl.addPoin);
router.post('/tukar', auth, requireAccess('master.poin', 'hakakses'), ctrl.tukarPoin);

module.exports = router;
