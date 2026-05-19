const router = require('express').Router();
const ctrl = require('../akuntansiController');
const auth = require('../../../middleware/auth');

router.use(auth);

router.get('/jurnal', ctrl.jurnalTransaksi);
router.get('/buku-besar', ctrl.bukuBesar);
router.get('/neraca', ctrl.neraca);

module.exports = router;
