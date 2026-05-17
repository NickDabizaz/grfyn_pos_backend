const router = require('express').Router();
const ctrl = require('../authController');
const auth = require('../../../middleware/auth');
const { authRefresh } = require('../../../middleware/auth');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/select-location', ctrl.selectLocation);
router.get('/access', auth, ctrl.access);
router.get('/me', auth, ctrl.me);
router.put('/password', auth, ctrl.changePassword);
router.post('/refresh', authRefresh, ctrl.refresh);

module.exports = router;
