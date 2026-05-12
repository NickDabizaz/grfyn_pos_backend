const router = require('express').Router();
const ctrl = require('../controllers/jualController');
const auth = require('../middleware/auth');
const { validateJual } = require('../middleware/validateRequest');

router.get('/', auth, ctrl.getAll);
router.get('/:id/check-edit', auth, ctrl.checkEdit);
router.get('/:id', auth, ctrl.getOne);
router.post('/', auth, validateJual, ctrl.create);
router.put('/:id/bayar', auth, ctrl.updateBayar);
router.put('/:id/cancel', auth, ctrl.cancel);
router.put('/:id', auth, validateJual, ctrl.update);

module.exports = router;
