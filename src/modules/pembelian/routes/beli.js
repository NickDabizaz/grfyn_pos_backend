const router = require('express').Router();
const ctrl = require('../beliController');
const auth = require('../../../middleware/auth');
const { validateBeli } = require('../../../middleware/validateRequest');

router.get('/', auth, ctrl.getAll);
router.get('/:id/check-edit', auth, ctrl.checkEdit);
router.get('/:id', auth, ctrl.getOne);
router.post('/', auth, validateBeli, ctrl.create);
router.put('/:id/approve', auth, ctrl.approve);
router.put('/:id/unapprove', auth, ctrl.unapprove);
router.put('/:id/cancel', auth, ctrl.cancel);
router.put('/:id', auth, validateBeli, ctrl.update);

module.exports = router;
