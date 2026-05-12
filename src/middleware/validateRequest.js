const { z } = require('zod');

const itemSchema = z.object({
  idbarang: z.number({ required_error: 'idbarang wajib diisi' }).int().positive('idbarang harus bilangan bulat positif'),
  jml     : z.number({ required_error: 'jml wajib diisi' }).int().positive('jml harus bilangan bulat > 0'),
  harga   : z.number({ required_error: 'harga wajib diisi' }).nonnegative('harga tidak boleh negatif'),
  satuan  : z.string().optional(),
  diskon  : z.number().min(0, 'diskon tidak boleh negatif').max(100, 'diskon maksimal 100%').optional().default(0),
  ppn     : z.number().nonnegative('ppn tidak boleh negatif').optional(),
});

const jualSchema = z.object({
  idcustomer: z.number().int().positive().optional().nullable(),
  bayar      : z.number().nonnegative('bayar tidak boleh negatif').optional().default(0),
  metodbayar : z.string().optional(),
  jenis      : z.string().optional(),
  tgltrans   : z.string().optional(),
  useppn     : z.boolean().optional(),
  langsung_lunas: z.boolean().optional(),
  items      : z.array(itemSchema).min(1, 'Minimal 1 item diperlukan'),
});

const beliSchema = z.object({
  idsupplier : z.number().int().positive('idsupplier wajib diisi').optional().nullable(),
  bayar      : z.number().nonnegative('bayar tidak boleh negatif').optional().default(0),
  metodbayar : z.string().optional(),
  tgltrans   : z.string().optional(),
  useppn     : z.boolean().optional(),
  items      : z.array(z.object({
    idbarang : z.number().int().positive('idbarang harus bilangan bulat positif'),
    jml      : z.number().int().positive('jml harus bilangan bulat > 0'),
    harga    : z.number().nonnegative('harga tidak boleh negatif'),
    satuan   : z.string().optional(),
    diskon   : z.number().min(0).max(100).optional().default(0),
  })).min(1, 'Minimal 1 item diperlukan'),
});

const returJualSchema = z.object({
  idjual    : z.number().int().positive('idjual wajib diisi'),
  tgltrans  : z.string().optional(),
  keterangan: z.string().optional(),
  items     : z.array(z.object({
    idbarang : z.number().int().positive('idbarang harus bilangan bulat positif'),
    jml      : z.number().int().positive('jml retur harus bilangan bulat > 0'),
    harga    : z.number().nonnegative().optional(),
    satuan   : z.string().optional(),
  })).min(1, 'Minimal 1 item retur diperlukan'),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const errors = result.error.errors.map(e => ({
        field  : e.path.join('.'),
        message: e.message,
      }));
      return res.status(400).json({ message: 'Validasi gagal', errors });
    }
    req.body = result.data;
    next();
  };
}

module.exports = {
  validateJual    : validate(jualSchema),
  validateBeli    : validate(beliSchema),
  validateReturJual: validate(returJualSchema),
};
