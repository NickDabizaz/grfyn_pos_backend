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
  idcustomer: z.number({ required_error: 'customer wajib dipilih' }).int().positive('customer wajib dipilih'),
  idlokasi   : z.number({ required_error: 'lokasi wajib dipilih' }).int().positive('lokasi wajib dipilih'),
  bayar      : z.number().nonnegative('bayar tidak boleh negatif').optional().default(0),
  metodbayar : z.string().optional(),
  jenis      : z.string().optional(),
  tgltrans   : z.string().optional(),
  useppn     : z.boolean().optional(),
  langsung_lunas: z.boolean().optional(),
  items      : z.array(itemSchema).min(1, 'Minimal 1 item diperlukan'),
});

const beliSchema = z.object({
  kodebeli   : z.string().optional().nullable(),
  idlokasi   : z.number({ required_error: 'lokasi wajib dipilih' }).int().positive('lokasi wajib dipilih'),
  idsupplier : z.number({ required_error: 'supplier wajib dipilih' }).int().positive('supplier wajib dipilih'),
  bayar      : z.number().nonnegative('bayar tidak boleh negatif').optional().default(0),
  metodbayar : z.string().optional(),
  tgltrans   : z.string().optional(),
  useppn     : z.boolean().optional(),
  langsung_lunas: z.boolean().optional(),
  approve    : z.boolean().optional(),
  idbpb      : z.number().int().positive().optional().nullable(),
  kodebpb    : z.string().optional().nullable(),
  jalurpembelian: z.enum(['PESANAN', 'LANGSUNG']).optional(),
  items      : z.array(z.object({
    idbarang : z.number().int().positive('idbarang harus bilangan bulat positif'),
    jml      : z.number().int().positive('jml harus bilangan bulat > 0'),
    harga    : z.number().nonnegative('harga tidak boleh negatif'),
    satuan   : z.string().optional(),
    diskon   : z.number().min(0).max(100).optional().default(0),
    ppn_mode : z.string().optional(),
  })).min(1, 'Minimal 1 item diperlukan'),
});

const returJualSchema = z.object({
  idcustomer: z.number({ required_error: 'customer wajib dipilih' }).int().positive('customer wajib dipilih'),
  idlokasi  : z.number({ required_error: 'lokasi wajib dipilih' }).int().positive('lokasi wajib dipilih'),
  idjual    : z.number().int().positive('idjual wajib diisi').optional().nullable(),
  kodejual  : z.string().optional().nullable(),
  catatan   : z.string().optional().nullable(),
  tgltrans  : z.string().optional(),
  keterangan: z.string().optional(),
  items     : z.array(z.object({
    idbarang : z.number().int().positive('idbarang harus bilangan bulat positif'),
    jml      : z.number().int().positive('jml retur harus bilangan bulat > 0'),
    harga    : z.number().nonnegative().optional(),
    satuan   : z.string().optional(),
    tindaklanjut: z.string().optional(),
    idbarang2nd : z.number().int().positive().optional().nullable(),
  })).min(1, 'Minimal 1 item retur diperlukan'),
});

const returBeliSchema = z.object({
  idsupplier: z.number({ required_error: 'supplier wajib dipilih' }).int().positive('supplier wajib dipilih'),
  idlokasi  : z.number({ required_error: 'lokasi wajib dipilih' }).int().positive('lokasi wajib dipilih'),
  idbeli    : z.number().int().positive().optional().nullable(),
  kodebeli  : z.string().optional().nullable(),
  tgltrans  : z.string().optional(),
  catatan   : z.string().optional().nullable(),
  approve   : z.boolean().optional(),
  items     : z.array(z.object({
    idbarang: z.number().int().positive('idbarang harus bilangan bulat positif'),
    jml     : z.number().positive('jml retur harus > 0'),
    harga   : z.number().nonnegative('harga tidak boleh negatif').optional().default(0),
    satuan  : z.string().optional(),
    diskon  : z.number().min(0).max(100).optional().default(0),
    ppn_mode: z.string().optional(),
  })).min(1, 'Minimal 1 item retur diperlukan'),
});

function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      const zodIssues = result.error?.issues || result.error?.errors || [];
      const errors = zodIssues.map(e => ({
        field  : Array.isArray(e.path) ? e.path.join('.') : '',
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
  validateReturBeli: validate(returBeliSchema),
};
