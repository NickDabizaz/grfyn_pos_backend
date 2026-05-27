require('dotenv').config();
const crypto = require('crypto');

const DEV_USERNAME = 'admin';
const DEV_COOKIE = 'grfyn.dev.auth';
const DEV_TTL_MS = 60 * 60 * 1000;

function getDevPassword() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `admin${yy}${mm}${dd}`;
}

function devAuth(req, res, next) {
  if (process.env.DEVELOPER_PORTAL_ENABLED === 'false') {
    return res.status(404).json({ message: 'Not Found' });
  }

  if (req.session && req.session.devAuthenticated) {
    return next();
  }

  const token = readCookie(req, DEV_COOKIE);
  if (verifyDevToken(token)) {
    if (req.session) {
      req.session.devAuthenticated = true;
      req.session.devLoginTime = new Date();
    }
    return next();
  }

  if (req.path === '/login' || (req.path === '/' && req.method === 'POST')) {
    return next();
  }

  if (req.accepts('html')) {
    return res.redirect('/developer/login');
  }

  return res.status(401).json({ message: 'Unauthorized' });
}

devAuth.validateLogin = function (username, password) {
  if (username !== DEV_USERNAME) return false;
  const expectedPassword = getDevPassword();
  return password === expectedPassword;
};

function getSecret() {
  return process.env.DEV_PORTAL_SECRET || 'grfyn_dev_portal_secret';
}

function sign(value) {
  return crypto.createHmac('sha256', getSecret()).update(value).digest('base64url');
}

function createDevToken(username = DEV_USERNAME) {
  const payload = Buffer.from(JSON.stringify({ username, iat: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function verifyDevToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return false;
  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf-8'));
    if (data.username !== DEV_USERNAME) return false;
    if (!data.iat || Date.now() - Number(data.iat) > DEV_TTL_MS) return false;
    return true;
  } catch (_) {
    return false;
  }
}

function readCookie(req, name) {
  const header = req.headers?.cookie || '';
  const parts = header.split(';').map((part) => part.trim());
  const prefix = `${name}=`;
  const found = parts.find((part) => part.startsWith(prefix));
  return found ? decodeURIComponent(found.slice(prefix.length)) : null;
}

devAuth.setCookie = function (res, username = DEV_USERNAME) {
  res.cookie(DEV_COOKIE, createDevToken(username), {
    path: '/developer',
    maxAge: DEV_TTL_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
  });
};

devAuth.clearCookie = function (res) {
  res.clearCookie(DEV_COOKIE, { path: '/developer' });
};

module.exports = devAuth;
