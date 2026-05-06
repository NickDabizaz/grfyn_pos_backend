const router = require('express').Router();
const ctrl = require('../controllers/authController');
const auth = require('../middleware/auth');

router.post('/register', ctrl.register);
router.post('/login', ctrl.login);
router.post('/select-location', ctrl.selectLocation);
router.get('/me', auth, ctrl.me);
router.put('/password', auth, ctrl.changePassword);

module.exports = router;
