const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/stockOpnameController');

router.use(auth);

router.get('/', ctrl.getAll);
router.post('/', ctrl.create);
router.get('/:id', ctrl.getOne);
router.put('/:id/fisik', ctrl.updateFisik);
router.put('/:id/finalize', ctrl.finalize);

module.exports = router;
