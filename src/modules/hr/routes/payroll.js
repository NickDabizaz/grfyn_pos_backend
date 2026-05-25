const express = require('express');
const router = express.Router();
const auth = require('../../../middleware/auth');
const { requireAccess } = require('../../../lib/access');
const { requireTransactionQuota } = require('../../../middleware/subscription');
const ctrl = require('../payrollController');

router.use(auth);

router.get('/', requireAccess('sdm.payroll', 'hakakses'), ctrl.getAll);
router.get('/:id', requireAccess('sdm.payroll', 'hakakses'), ctrl.getOne);
router.post('/generate', requireAccess('sdm.payroll', 'tambah'), requireTransactionQuota(), ctrl.generate);
router.put('/:id/posting', requireAccess('sdm.payroll', 'ubah'), ctrl.posting);
router.put('/:id/unpost', requireAccess('sdm.payroll', 'ubah'), ctrl.unpost);
router.delete('/:id', requireAccess('sdm.payroll', 'ubah'), ctrl.cancel);

module.exports = router;
