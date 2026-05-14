const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const ctrl = require('../grnController');

router.use(auth);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);

module.exports = router;
