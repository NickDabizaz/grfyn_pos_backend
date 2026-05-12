const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/absensiController');

router.use(auth);

router.get('/rekap', ctrl.rekapBulanan);
router.get('/', ctrl.getAll);
router.post('/', ctrl.create);
router.put('/:id', ctrl.update);

module.exports = router;
