const router = require('express').Router();
const ctrl = require('../returbeliController');
const auth = require('../../../middleware/auth');
const { validateReturBeli } = require('../../../middleware/validateRequest');

router.get('/', auth, ctrl.getAll);
router.get('/:id', auth, ctrl.getOne);
router.post('/', auth, validateReturBeli, ctrl.create);
router.put('/:id/approve', auth, ctrl.approve);
router.put('/:id', auth, validateReturBeli, ctrl.update);
router.put('/:id/unapprove', auth, ctrl.unapprove);
router.put('/:id/cancel', auth, ctrl.cancel);

module.exports = router;
