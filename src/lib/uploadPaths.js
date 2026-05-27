const fs = require('fs');
const path = require('path');

const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads');

function getTenantFolder(idtenant) {
  const tenantId = Number.parseInt(idtenant, 10);
  if (!Number.isInteger(tenantId) || tenantId <= 0) {
    throw new Error('TENANT_NOT_FOUND: idtenant tidak valid untuk upload');
  }
  return `tenant-${tenantId}`;
}

function ensureTenantUploadDir(idtenant, category) {
  const dir = path.join(UPLOAD_ROOT, getTenantFolder(idtenant), category);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getTenantUploadUrl(idtenant, category, filename) {
  return `/uploads/${getTenantFolder(idtenant)}/${category}/${filename}`;
}

function resolveUploadPath(uploadPath) {
  if (!uploadPath) return null;

  let normalized = String(uploadPath).replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.startsWith('uploads/')) {
    normalized = normalized.slice('uploads/'.length);
  }

  const absolutePath = path.resolve(UPLOAD_ROOT, normalized);
  const root = path.resolve(UPLOAD_ROOT);
  if (absolutePath !== root && !absolutePath.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  return absolutePath;
}

function removeUploadFile(uploadPath) {
  const absolutePath = resolveUploadPath(uploadPath);
  if (absolutePath) fs.unlink(absolutePath, () => {});
}

module.exports = {
  UPLOAD_ROOT,
  ensureTenantUploadDir,
  getTenantFolder,
  getTenantUploadUrl,
  removeUploadFile,
  resolveUploadPath,
};
