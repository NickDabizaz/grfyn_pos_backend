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
const authRoutes        = require('./routes/auth');
const menuRoutes        = require('./routes/menu');
const userRoutes        = require('./routes/user');
const lokasiRoutes      = require('./routes/lokasi');
const barangRoutes      = require('./routes/barang');
const customerRoutes    = require('./routes/customer');
const supplierRoutes    = require('./routes/supplier');
const jualRoutes        = require('./routes/jual');
const returjualRoutes   = require('./routes/returjual');
const tukarbarangRoutes = require('./routes/tukarbarang');
const beliRoutes        = require('./routes/beli');
const stokRoutes        = require('./routes/stok');
const laporanRoutes     = require('./routes/laporan');
const dashboardRoutes   = require('./routes/dashboard');
const settingRoutes     = require('./routes/setting');
const akunRoutes        = require('./routes/akun');
const kasRoutes         = require('./routes/kas');
const imporRoutes       = require('./routes/impor');
const hitunghppRoutes   = require('./routes/hitunghpp');
const kartupiutangRoutes = require('./routes/kartupiutang');
const pelunasanpiutangRoutes = require('./routes/pelunasanpiutang');
const kartuhutangRoutes = require('./routes/kartuhutang');
const pelunasanhutangRoutes = require('./routes/pelunasanhutang');

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
app.use('/api/tukarbarang', tukarbarangRoutes);
app.use('/api/beli', beliRoutes);
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

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

if (process.env.DEVELOPER_PORTAL_ENABLED !== 'false') {
  const developerRoutes = require('./developer');
  app.use('/developer', developerRoutes);
}

// Global error handler
app.use((err, req, res, next) => {
  logger.error(err, { req });
  res.status(500).json({ message: 'Internal Server Error' });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`Grfyn POS Backend running on port ${PORT}`);
// Developer Portal (hanya aktif jika DEVELOPER_PORTAL_ENABLED !== 'false')
if (process.env.DEVELOPER_PORTAL_ENABLED !== 'false') {
    console.log(`Developer Portal: http://localhost:${PORT}/developer`);
  }
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
