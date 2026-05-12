const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/payrollController');

router.use(auth);

router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/generate', ctrl.generate);
router.put('/:id/posting', ctrl.posting);

module.exports = router;
