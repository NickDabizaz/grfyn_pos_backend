require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initTenantNamespace, getNamespace, TENANT_NS } = require('./config/db');

const authRoutes      = require('./routes/auth');
const menuRoutes      = require('./routes/menu');
const userRoutes      = require('./routes/user');
const lokasiRoutes    = require('./routes/lokasi');
const barangRoutes    = require('./routes/barang');
const customerRoutes  = require('./routes/customer');
const supplierRoutes  = require('./routes/supplier');
const jualRoutes      = require('./routes/jual');
const beliRoutes      = require('./routes/beli');
const stokRoutes      = require('./routes/stok');
const laporanRoutes   = require('./routes/laporan');
const dashboardRoutes = require('./routes/dashboard');
const settingRoutes   = require('./routes/setting');
const akunRoutes      = require('./routes/akun');
const kasRoutes       = require('./routes/kas');
const imporRoutes     = require('./routes/impor');

const app = express();
const PORT = process.env.PORT || 5000;

initTenantNamespace();

app.use((req, res, next) => {
  const ns = getNamespace(TENANT_NS);
  ns.run(() => {
    next();
  });
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'reports'));

app.use('/reports', express.static(path.join(__dirname, '..', 'reports')));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

app.use('/api/auth', authRoutes);
app.use('/api/menu', menuRoutes);
app.use('/api/user', userRoutes);
app.use('/api/lokasi', lokasiRoutes);
app.use('/api/barang', barangRoutes);
app.use('/api/customer', customerRoutes);
app.use('/api/supplier', supplierRoutes);
app.use('/api/jual', jualRoutes);
app.use('/api/beli', beliRoutes);
app.use('/api/stok', stokRoutes);
app.use('/api/laporan', laporanRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/setting', settingRoutes);
app.use('/api/akun', akunRoutes);
app.use('/api/kas', kasRoutes);
app.use('/api/impor', imporRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

const server = app.listen(PORT, () => {
  console.log(`Grfyn POS Backend running on port ${PORT}`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Kill the existing process or set a different PORT in .env`);
  } else {
    console.error('Server error:', err.message);
  }
  process.exit(1);
});
