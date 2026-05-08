const router = require('express').Router();
const ctrl = require('../controllers/laporanController');
const auth = require('../middleware/auth');

router.get('/sales-transaksi', auth, ctrl.salesTransaksi);
router.get('/sales-per-customer', auth, ctrl.salesPerCustomer);
router.get('/sales-per-barang', auth, ctrl.salesPerBarang);
router.get('/sales-per-lokasi', auth, ctrl.salesPerLokasi);
router.get('/pembelian', auth, ctrl.pembelian);
router.get('/pembelian-per-supplier', auth, ctrl.pembelianPerSupplier);
router.get('/pembelian-per-lokasi', auth, ctrl.pembelianPerLokasi);
router.get('/pembelian-per-barang', auth, ctrl.pembelianPerBarang);
router.get('/pembelian-rekap', auth, ctrl.pembelianRekap);
router.get('/stok', auth, ctrl.stok);
router.get('/kartu-stok', auth, ctrl.kartuStok);
router.get('/rekap-sales', auth, ctrl.rekapSales);
router.get('/struk/:id', auth, ctrl.struk);
router.get('/faktur/:id', auth, ctrl.faktur);

module.exports = router;
