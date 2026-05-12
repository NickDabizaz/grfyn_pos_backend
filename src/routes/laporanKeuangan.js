const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const ctrl = require('../controllers/laporanKeuanganController');

router.use(auth);

router.get('/neraca-saldo', ctrl.neracaSaldo);
router.get('/laba-rugi', ctrl.labaRugi);
router.get('/neraca', ctrl.neraca);
router.get('/buku-besar', ctrl.bukuBesar);
router.post('/closing', ctrl.closingPeriode);
router.get('/closing', ctrl.getClosingList);

module.exports = router;
