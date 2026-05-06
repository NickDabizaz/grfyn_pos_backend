const router = require('express').Router();
const ctrl = require('../controllers/userController');
const auth = require('../middleware/auth');

// Users
router.get('/', auth, ctrl.getAll);
router.get('/:id', auth, ctrl.getOne);
router.post('/', auth, ctrl.create);
router.put('/:id', auth, ctrl.update);
router.put('/:id/reset-password', auth, ctrl.resetPassword);
router.get('/:id/menu', auth, ctrl.getMenus);
router.get('/:id/lokasi', auth, ctrl.getLokasis);

// Templates
router.get('/template/list', auth, ctrl.getAllTemplates);
router.get('/template/:id', auth, ctrl.getTemplateDetail);
router.post('/template', auth, ctrl.createTemplate);
router.put('/template/:id', auth, ctrl.updateTemplate);
router.delete('/template/:id', auth, ctrl.deleteTemplate);

module.exports = router;
