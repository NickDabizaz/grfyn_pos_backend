const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/purchaseOrderController');

router.use(auth);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/', ctrl.create);
router.put('/:id/approve', ctrl.approve);
router.put('/:id/batal', ctrl.batal);

module.exports = router;
