const router = require('express').Router();
const ctrl = require('../userController');
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');

// Templates — MUST come before /:id to avoid being matched as "id" param
router.get('/templates', auth, requireAccess('master.user', 'hakakses'), ctrl.getAllTemplates);
router.get('/template/:id', auth, requireAccess('master.user', 'hakakses'), ctrl.getTemplateDetail);
router.post('/template', auth, requireAccess('master.user', 'tambah'), ctrl.createTemplate);
router.put('/template/:id', auth, requireAccess('master.user', 'ubah'), ctrl.updateTemplate);
router.delete('/template/:id', auth, requireAccess('master.user', 'ubah'), ctrl.deleteTemplate);

// Users
router.get('/', auth, requireAccess('master.user', 'hakakses'), ctrl.getAll);
router.get('/:id', auth, requireAccess('master.user', 'hakakses'), ctrl.getOne);
router.post('/', auth, requireAccess('master.user', 'tambah'), ctrl.create);
router.put('/:id', auth, requireAccess('master.user', 'ubah'), ctrl.update);
router.put('/:id/reset-password', auth, requireAccess('master.user', 'ubah'), ctrl.resetPassword);
router.get('/:id/menu', auth, requireAccess('master.user', 'hakakses'), ctrl.getMenus);
router.get('/:id/menus', auth, requireAccess('master.user', 'hakakses'), ctrl.getMenus);
router.get('/:id/lokasi', auth, requireAccess('master.user', 'hakakses'), ctrl.getLokasis);
router.get('/:id/lokasis', auth, requireAccess('master.user', 'hakakses'), ctrl.getLokasis);

module.exports = router;
