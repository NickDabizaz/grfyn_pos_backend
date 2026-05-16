const router = require('express').Router();
const ctrl = require('../bpkController');
const auth = require('../../../middleware/auth');

router.get('/', auth, ctrl.getAll);
router.get('/:id', auth, ctrl.getOne);
router.post('/', auth, ctrl.create);
router.put('/:id/approve', auth, ctrl.approve);
router.put('/:id/unapprove', auth, ctrl.unapprove);
router.put('/:id', auth, ctrl.update);

module.exports = router;
