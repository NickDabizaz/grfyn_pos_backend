const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const devAuth = require('./middleware/devAuth');
const authController = require('./controllers/authController');
const dashboardController = require('./controllers/dashboardController');
const logController = require('./controllers/logController');
const historyController = require('./controllers/historyController');
const dbHealthController = require('./controllers/dbHealthController');
const systemController = require('./controllers/systemController');
const tenantController = require('./controllers/tenantController');
const dbConsoleController = require('./controllers/dbConsoleController');
const maintenanceController = require('./controllers/maintenanceController');

const router = express.Router();

router.use(session({
  secret: process.env.DEV_PORTAL_SECRET || 'grfyn_dev_portal_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 60 * 60 * 1000,
    httpOnly: true,
    secure: false
  }
}));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Terlalu banyak percobaan login. Coba lagi 15 menit.',
  standardHeaders: true,
  legacyHeaders: false
});

router.use(express.urlencoded({ extended: true }));

router.get('/login', authController.loginPage);
router.post('/login', loginLimiter, authController.login);
router.get('/logout', authController.logout);

router.use(devAuth);

router.get('/', dashboardController.index);

router.get('/logs/error', logController.errorLog);
router.get('/logs/error/download', logController.downloadLog);
router.post('/logs/error/delete', logController.deleteLog);
router.get('/logs/history', historyController.historyLog);

router.get('/database', dbHealthController.index);
router.get('/database/processlist', dbHealthController.processList);

router.get('/system', systemController.index);
router.get('/system/api', systemController.api);

router.get('/tenants', tenantController.index);

router.get('/db-console', dbConsoleController.index);
router.post('/db-console', dbConsoleController.execute);

router.get('/maintenance', maintenanceController.index);
router.post('/maintenance/clear-logs', maintenanceController.clearOldLogs);

module.exports = router;
