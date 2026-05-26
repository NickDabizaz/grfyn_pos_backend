const router = require('express').Router();
const ctrl = require('../exportController');
const auth = require('../../../middleware/auth');

router.get('/sales-transaksi', auth, ctrl.exportSalesTransaksi);
router.get('/sales-per-barang', auth, ctrl.exportSalesPerBarang);
router.get('/pembelian', auth, ctrl.exportPembelian);
router.get('/stok', auth, ctrl.exportStok);
router.get('/kartu-stok', auth, ctrl.exportKartuStok);

module.exports = router;
