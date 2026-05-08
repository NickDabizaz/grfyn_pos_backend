const router = require('express').Router();
const ctrl = require('../controllers/barangController');
const auth = require('../middleware/auth');

router.get('/', auth, ctrl.getAll);
router.get('/browse-barang', auth, ctrl.browseBarang);
router.get('/check-price', auth, ctrl.checkPrice);
router.get('/:id', auth, ctrl.getOne);
router.post('/', auth, ctrl.create);
router.put('/:id', auth, ctrl.update);
router.delete('/:id', auth, ctrl.remove);
router.get('/:id/hargabeli', auth, ctrl.getHargaBeli);
router.get('/:id/hargajual', auth, ctrl.getHargaJual);

module.exports = router;
