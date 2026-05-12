const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/shiftController');

router.use(auth);

router.get('/aktif', ctrl.getAktif);
router.get('/', ctrl.getAll);
router.get('/:id', ctrl.getOne);
router.post('/buka', ctrl.buka);
router.put('/:id/tutup', ctrl.tutup);

module.exports = router;
