const router = require('express').Router();
const ctrl = require('../controllers/stokController');
const auth = require('../middleware/auth');

// Kartu stok
router.get('/kartustok', auth, ctrl.getKartuStok);

// Penyesuaian stok
router.get('/penyesuaian', auth, ctrl.getPenyesuaian);
router.get('/penyesuaian/:id', auth, ctrl.getPenyesuaianDetail);
router.post('/penyesuaian', auth, ctrl.createPenyesuaian);

// Saldo stok
router.get('/saldostok', auth, ctrl.getSaldoStok);
router.get('/saldostok-list', auth, ctrl.getSaldoStokList);
router.get('/saldostok/:id', auth, ctrl.getSaldoStokDetail);
router.post('/saldoawal', auth, ctrl.createSaldoAwal);

// Closing
router.post('/closing', auth, ctrl.createClosing);
router.get('/closing', auth, ctrl.getClosing);
router.get('/closing/:id', auth, ctrl.getClosingDetail);
router.put('/closing/:id/cancel', auth, ctrl.cancelClosing);

// Get stok per barang
router.get('/getstok/:idbarang', auth, ctrl.getStok);

module.exports = router;
