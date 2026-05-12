const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/transferstokController');

router.use(auth);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id/kirim', ctrl.kirim);
router.put('/:id/terima', ctrl.terima);
router.put('/:id/batal', ctrl.batal);

module.exports = router;
