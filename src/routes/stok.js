const router = require('express').Router();
const ctrl = require('../controllers/stokController');
const auth = require('../middleware/auth');

// Penyesuaian stok
router.get('/penyesuaian', auth, ctrl.getPenyesuaian);
router.get('/penyesuaian/:id', auth, ctrl.getPenyesuaianDetail);
router.post('/penyesuaian', auth, ctrl.createPenyesuaian);

// Saldo awal stok
router.post('/saldoawal', auth, ctrl.createSaldoAwal);

// Get stok per barang (utility)
router.get('/getstok/:idbarang', auth, ctrl.getStok);

module.exports = router;
