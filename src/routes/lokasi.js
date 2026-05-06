const router = require('express').Router();
const ctrl = require('../controllers/lokasiController');
const auth = require('../middleware/auth');

router.get('/', auth, ctrl.getAll);
router.post('/', auth, ctrl.create);
router.put('/:id', auth, ctrl.update);

module.exports = router;
