const router = require('express').Router();
const ctrl = require('../controllers/menuController');
const auth = require('../middleware/auth');

router.get('/my', auth, ctrl.myMenu);

module.exports = router;
