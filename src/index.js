/**
 * Entry point aplikasi Grfyn POS Backend.
 * - Setup Express server dengan middleware (CORS, JSON, URL-encoded)
 * - Multi-tenancy context via AsyncLocalStorage (diset di auth middleware per request)
 * - Registrasi semua route API (auth, menu, user, master data, transaksi, laporan, dll)
 * - Setup view engine EJS untuk render laporan HTML dan developer portal
 * - Health check endpoint dan global error handler
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initTenantNamespace } = require('./config/db');
const logger = require('./lib/logger');

// Import semua route module
const authRoutes        = require('./modules/auth/routes/auth');
const menuRoutes        = require('./modules/master/routes/menu');
const userRoutes        = require('./modules/master/routes/user');
const lokasiRoutes      = require('./modules/master/routes/lokasi');
const barangRoutes      = require('./modules/master/routes/barang');
const customerRoutes    = require('./modules/master/routes/customer');
const supplierRoutes    = require('./modules/master/routes/supplier');
const jualRoutes        = require('./modules/penjualan/routes/jual');
const returjualRoutes   = require('./modules/penjualan/routes/returjual');
const salesOrderRoutes  = require('./modules/penjualan/routes/salesOrder');
const bpkRoutes         = require('./modules/penjualan/routes/bpk');
const beliRoutes        = require('./modules/pembelian/routes/beli');
const returbeliRoutes   = require('./modules/pembelian/routes/returbeli');
const stokRoutes        = require('./modules/stok/routes/stok');
const laporanRoutes     = require('./modules/laporan/routes/laporan');
const dashboardRoutes   = require('./modules/laporan/routes/dashboard');
const settingRoutes     = require('./modules/pos/routes/setting');
const akunRoutes        = require('./modules/master/routes/akun');
const kasRoutes         = require('./modules/keuangan/routes/kas');
const imporRoutes       = require('./modules/laporan/routes/impor');
const hitunghppRoutes   = require('./modules/stok/routes/hitunghpp');
const kartupiutangRoutes = require('./modules/keuangan/routes/kartupiutang');
const pelunasanpiutangRoutes = require('./modules/keuangan/routes/pelunasanpiutang');
const kartuhutangRoutes = require('./modules/keuangan/routes/kartuhutang');
const pelunasanhutangRoutes = require('./modules/keuangan/routes/pelunasanhutang');
const produksiRoutes = require('./modules/stok/routes/produksiRoutes');
const laporanKeuanganRoutes = require('./modules/keuangan/routes/laporanKeuangan');
const laporanAkuntansiRoutes = require('./modules/laporan/routes/akuntansi');
const transferstokRoutes    = require('./modules/stok/routes/transferstok');
const posKasirRoutes        = require('./modules/pos/routes/kasir');
const purchaseOrderRoutes   = require('./modules/pembelian/routes/purchaseOrder');
const bpbRoutes             = require('./modules/pembelian/routes/bpb');
const stockOpnameRoutes     = require('./modules/stok/routes/stockOpname');
const karyawanRoutes        = require('./modules/hr/routes/karyawan');
const absensiRoutes         = require('./modules/hr/routes/absensi');
const payrollRoutes         = require('./modules/hr/routes/payroll');
const subscriptionRoutes    = require('./modules/subscription/routes/subscription');
const poinRoutes            = require('./modules/master/routes/poin');
const diskonRoutes          = require('./modules/penjualan/routes/diskon');
const hargaLevelRoutes      = require('./modules/master/routes/hargaLevel');
const asetRoutes            = require('./modules/aset/routes/aset');
const anggaranRoutes        = require('./modules/keuangan/routes/anggaran');
const cutiRoutes            = require('./modules/hr/routes/cuti');
const lemburRoutes          = require('./modules/hr/routes/lembur');
const batchLotRoutes        = require('./modules/stok/routes/batchLot');
const exportLaporanRoutes   = require('./modules/laporan/routes/export');
const webhookRoutes         = require('./modules/subscription/routes/webhook');
const { ensureSubscriptionSchema } = require('./lib/subscription');
require('./lib/jobqueue'); // start background job queue

const app = express();
const PORT = process.env.PORT || 5000;

initTenantNamespace(); // no-op; kept for backward-compat if any module calls it
logger.cleanOldLogs();

// Middleware standar
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// View engine EJS untuk render laporan dan developer portal
app.set('view engine', 'ejs');
app.set('views', [
  path.join(__dirname, '..', 'reports'),
  path.join(__dirname, 'developer', 'views')
]);

// Static file serving
app.use('/reports', express.static(path.join(__dirname, '..', 'reports')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// Registrasi semua route API
app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/user', userRoutes);
app.use('/api/lokasi', lokasiRoutes);
app.use('/api/barang', barangRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/supplier', supplierRoutes);
app.use('/api/jual', jualRoutes);
app.use('/api/returjual', returjualRoutes);
app.use('/api/sales-order', salesOrderRoutes);
app.use('/api/bpk-jual', bpkRoutes);
app.use('/api/beli', beliRoutes);
app.use('/api/returbeli', returbeliRoutes);
app.use('/api/stok', stokRoutes);
app.use('/api/laporan', laporanRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/setting', settingRoutes);
app.use('/api/akun', akunRoutes);
app.use('/api/kas', kasRoutes);
app.use('/api/impor', imporRoutes);
app.use('/api/hitunghpp', hitunghppRoutes);
app.use('/api/kartupiutang', kartupiutangRoutes);
app.use('/api/pelunasanpiutang', pelunasanpiutangRoutes);
app.use('/api/kartuhutang', kartuhutangRoutes);
app.use('/api/pelunasanhutang', pelunasanhutangRoutes);
app.use('/api/produksi', produksiRoutes);
app.use('/api/laporan-keuangan', laporanKeuanganRoutes);
app.use('/api/laporan-akuntansi', laporanAkuntansiRoutes);
app.use('/api/transfer-stok', transferstokRoutes);
app.use('/api/pos', posKasirRoutes);
app.use('/api/purchase-order', purchaseOrderRoutes);
app.use('/api/bpb', bpbRoutes);
app.use('/api/stock-opname', stockOpnameRoutes);
app.use('/api/karyawan', karyawanRoutes);
app.use('/api/absensi', absensiRoutes);
app.use('/api/payroll', payrollRoutes);
app.use('/api/subscription', subscriptionRoutes);
app.use('/api/poin', poinRoutes);
app.use('/api/diskon', diskonRoutes);
app.use('/api/harga-level', hargaLevelRoutes);
app.use('/api/aset', asetRoutes);
app.use('/api/anggaran', anggaranRoutes);
app.use('/api/cuti', cutiRoutes);
app.use('/api/lembur', lemburRoutes);
app.use('/api/batch-lot', batchLotRoutes);
app.use('/api/laporan/export', exportLaporanRoutes);
app.use('/api/webhook', webhookRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

if (process.env.DEVELOPER_PORTAL_ENABLED !== 'false') {
  const developerRoutes = require('./developer');
  app.use('/developer', developerRoutes);
}

app.get('/subscription', (req, res) => {
  const frontendBase = (process.env.FRONTEND_URL || 'http://localhost:3000').replace(/\/+$/, '');
  const redirectUrl = new URL('/app', `${frontendBase}/`);

  Object.entries(req.query || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => redirectUrl.searchParams.append(key, item));
    } else if (value !== undefined) {
      redirectUrl.searchParams.set(key, value);
    }
  });
  redirectUrl.searchParams.set('open', 'subscription');

  res.redirect(302, redirectUrl.toString());
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error(err, { req });
  res.status(500).json({ message: 'Internal Server Error' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Grfyn POS Backend running on port ${PORT}`);
  if (process.env.DEVELOPER_PORTAL_ENABLED !== 'false') {
    console.log(`Developer Portal: http://localhost:${PORT}/developer`);
  }
});

ensureSubscriptionSchema().catch((err) => {
  logger.error(err, { context: 'ensureSubscriptionSchema' });
  console.error('Subscription schema initialization failed:', err.message);
});

// Handle error saat server start (misal port sudah dipakai)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill the existing process or set a different PORT in .env`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
