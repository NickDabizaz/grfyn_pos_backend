const router = require('express').Router();
const ctrl = require('../webhookController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

router.get('/:id/logs', auth, requireAccess('setting.webhook', 'hakakses'), ctrl.getLogs);
router.post('/:id/test', auth, requireAccess('setting.webhook', 'tambah'), ctrl.test);
router.get('/', auth, requireAccess('setting.webhook', 'hakakses'), ctrl.getAll);
router.post('/', auth, requireAccess('setting.webhook', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('setting.webhook', 'ubah'), ctrl.update);
router.delete('/:id', auth, requireAccess('setting.webhook', 'tambah'), ctrl.remove);

module.exports = router;
