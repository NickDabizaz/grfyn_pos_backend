const router = require('express').Router();
const ctrl = require('../controllers/returjualController');
const auth = require('../middleware/auth');
const { validateReturJual } = require('../middleware/validateRequest');

router.get('/', auth, ctrl.getAll);
router.get('/:id', auth, ctrl.getOne);
router.post('/', auth, validateReturJual, ctrl.create);
router.put('/:id/cancel', auth, ctrl.cancel);

module.exports = router;
