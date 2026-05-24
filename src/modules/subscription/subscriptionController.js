const crypto = require('crypto');
const { pool, getConnection, getTenantContext } = require('../../config/db');
const logger = require('../../lib/logger');
const {
  PLAN_PRO,
  buildSubscriptionStatus,
  ensureSubscriptionSchema,
  getEffectiveSubscription,
  mapMidtransStatus,
} = require('../../lib/subscription');

const MIDTRANS_SNAP_PRODUCTION_URL = 'https://app.midtrans.com/snap/v1/transactions';
const MIDTRANS_API_PRODUCTION_BASE_URL = 'https://api.midtrans.com/v2';

async function requireOwner(ctx) {
  const [[user]] = await pool.query(
    'SELECT isowner FROM user WHERE iduser = ? AND idtenant = ? LIMIT 1',
    [ctx.iduser, ctx.idtenant]
  );
  if (!user || Number(user.isowner) !== 1) {
    const err = new Error('Hanya owner tenant yang dapat mengelola subscription');
    err.statusCode = 403;
    throw err;
  }
}

async function callMidtransSnap(payload) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    const err = new Error('MIDTRANS_SERVER_KEY belum diisi di .env backend');
    err.statusCode = 500;
    throw err;
  }

  const response = await fetch(MIDTRANS_SNAP_PRODUCTION_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_messages?.join(', ') || data.message || 'Gagal membuat transaksi Midtrans';
    const err = new Error(message);
    err.statusCode = response.status;
    err.midtrans = data;
    throw err;
  }
  return data;
}

function midtransAuthHeaders() {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) {
    const err = new Error('MIDTRANS_SERVER_KEY belum diisi di .env backend');
    err.statusCode = 500;
    throw err;
  }

  return {
    Authorization: `Basic ${Buffer.from(`${serverKey}:`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
}

function getMidtransApiBaseUrl() {
  return (process.env.MIDTRANS_API_BASE_URL || MIDTRANS_API_PRODUCTION_BASE_URL).replace(/\/+$/, '');
}

async function callMidtransApi(pathname, options = {}) {
  const response = await fetch(`${getMidtransApiBaseUrl()}${pathname}`, {
    method: options.method || 'GET',
    headers: midtransAuthHeaders(),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.status_message || data.error_messages?.join(', ') || data.message || 'Gagal memanggil Midtrans';
    const err = new Error(message);
    err.statusCode = response.status;
    err.midtrans = data;
    throw err;
  }
  return data;
}

async function getMidtransStatus(orderId) {
  return callMidtransApi(`/${encodeURIComponent(orderId)}/status`);
}

async function expireMidtransTransaction(orderId) {
  return callMidtransApi(`/${encodeURIComponent(orderId)}/expire`, { method: 'POST' });
}

function verifyMidtransSignature(body) {
  const serverKey = process.env.MIDTRANS_SERVER_KEY;
  if (!serverKey) return false;
  const raw = `${body.order_id || ''}${body.status_code || ''}${body.gross_amount || ''}${serverKey}`;
  const expected = crypto.createHash('sha512').update(raw).digest('hex');
  return expected === body.signature_key;
}

function oneMonthFromNowExpression() {
  return 'DATE_ADD(GREATEST(COALESCE(subscription_expires_at, NOW()), NOW()), INTERVAL 1 MONTH)';
}

async function applyMidtransStatus(conn, body, options = {}) {
  const { verifySignature = true, idtenant = null, req = null } = options;

  if (!body.order_id) {
    const err = new Error('order_id tidak ditemukan');
    err.statusCode = 400;
    throw err;
  }
  if (verifySignature && !verifyMidtransSignature(body)) {
    const err = new Error('Signature Midtrans tidak valid');
    err.statusCode = 403;
    throw err;
  }

  await ensureSubscriptionSchema();
  await conn.beginTransaction();
  const params = [body.order_id];
  let whereTenant = '';
  if (idtenant) {
    whereTenant = ' AND idtenant = ?';
    params.push(idtenant);
  }

  const [[payment]] = await conn.query(
    `SELECT * FROM subscription_payment WHERE order_id = ?${whereTenant} FOR UPDATE`,
    params
  );
  if (!payment) {
    await conn.rollback();
    const err = new Error('Payment tidak ditemukan');
    err.statusCode = 404;
    throw err;
  }

  const nextStatus = mapMidtransStatus(body);
  await conn.query(
    `UPDATE subscription_payment
     SET status = ?,
         midtrans_transaction_status = ?,
         midtrans_payment_type = ?,
         midtrans_fraud_status = ?,
         paid_at = IF(? = 'PAID', COALESCE(paid_at, NOW()), paid_at),
         expired_at = IF(? = 'FAILED' AND ? IN ('expire', 'cancel'), COALESCE(expired_at, NOW()), expired_at),
         raw_notification = ?
     WHERE idpayment = ?`,
    [
      nextStatus,
      body.transaction_status || null,
      body.payment_type || null,
      body.fraud_status || null,
      nextStatus,
      nextStatus,
      String(body.transaction_status || '').toLowerCase(),
      JSON.stringify(body),
      payment.idpayment,
    ]
  );

  if (nextStatus === 'PAID' && payment.plan_code === PLAN_PRO) {
    await conn.query(
      `UPDATE tenant
       SET subscription_plan = 'PRO',
           subscription_status = 'ACTIVE',
           subscription_started_at = COALESCE(subscription_started_at, NOW()),
           subscription_expires_at = ${oneMonthFromNowExpression()}
       WHERE idtenant = ?`,
      [payment.idtenant]
    );
  }

  await conn.commit();
  await logger.history('SUBSCRIPTION_NOTIFICATION', {
    idtenant: payment.idtenant,
    ref: body.order_id,
    detail: { status: nextStatus, midtrans_status: body.transaction_status },
    req,
  });

  return { payment, status: nextStatus };
}

async function syncPendingPayments(idtenant, req) {
  if (!process.env.MIDTRANS_SERVER_KEY) return;

  const [payments] = await pool.query(
    `SELECT order_id, midtrans_transaction_status
     FROM subscription_payment
     WHERE idtenant = ? AND status = 'PENDING'
     ORDER BY idpayment DESC
     LIMIT 10`,
    [idtenant]
  );

  for (const payment of payments) {
    const conn = await getConnection();
    try {
      const midtransStatus = await getMidtransStatus(payment.order_id);
      if (midtransStatus?.transaction_status) {
        const txStatus = String(midtransStatus.transaction_status || '').toLowerCase();
        const nextStatus = mapMidtransStatus(midtransStatus);
        if (nextStatus !== 'PENDING' || txStatus !== String(payment.midtrans_transaction_status || '').toLowerCase()) {
          await applyMidtransStatus(conn, midtransStatus, {
            verifySignature: false,
            idtenant,
            req,
          });
        }
      }
    } catch (err) {
      try { await conn.rollback(); } catch (_) {}
      const statusCode = Number(err.statusCode || 0);
      if (statusCode !== 404) logger.error(err, { req });
    } finally {
      conn.release();
    }
  }
}

exports.getStatus = async (req, res) => {
  try {
    const ctx = getTenantContext();
    await ensureSubscriptionSchema();
    await syncPendingPayments(ctx.idtenant, req);
    res.json(await buildSubscriptionStatus(pool, ctx.idtenant));
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};

exports.checkout = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await ensureSubscriptionSchema();
    await requireOwner(ctx);
    await syncPendingPayments(ctx.idtenant, req);

    const [[plan]] = await conn.query(
      "SELECT * FROM subscription_plan WHERE kodeplan = 'PRO' AND status = 'AKTIF' LIMIT 1"
    );
    if (!plan) return res.status(404).json({ message: 'Plan PRO tidak ditemukan' });

    const amount = Math.round(Number(plan.harga || 0));
    if (amount <= 0) return res.status(400).json({ message: 'Harga subscription PRO belum valid di database' });

    const [[pendingPayment]] = await conn.query(
      `SELECT order_id, amount, midtrans_token, midtrans_redirect_url
       FROM subscription_payment
       WHERE idtenant = ?
         AND plan_code = ?
         AND status = 'PENDING'
         AND amount = ?
         AND midtrans_redirect_url IS NOT NULL
       ORDER BY idpayment DESC
       LIMIT 1`,
      [ctx.idtenant, PLAN_PRO, amount]
    );
    if (pendingPayment) {
      return res.json({
        order_id: pendingPayment.order_id,
        token: pendingPayment.midtrans_token,
        redirect_url: pendingPayment.midtrans_redirect_url,
        amount: Number(pendingPayment.amount || 0),
        mode: 'production',
        existing: true,
      });
    }

    const [[tenant]] = await conn.query('SELECT namatenant, email, hp FROM tenant WHERE idtenant = ?', [ctx.idtenant]);
    const [[owner]] = await conn.query(
      'SELECT namauser, email, hp FROM user WHERE iduser = ? AND idtenant = ?',
      [ctx.iduser, ctx.idtenant]
    );

    const orderId = `SUB-${ctx.idtenant}-${Date.now()}`;

    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO subscription_payment
        (idtenant, order_id, plan_code, amount, status, userentry)
       VALUES (?, ?, ?, ?, 'PENDING', ?)`,
      [ctx.idtenant, orderId, PLAN_PRO, amount, ctx.iduser]
    );
    await conn.commit();

    const snapPayload = {
      transaction_details: {
        order_id: orderId,
        gross_amount: amount,
      },
      item_details: [
        {
          id: 'GRFYN-POS-PRO',
          price: amount,
          quantity: 1,
          name: 'Grfyn POS PRO - 1 Bulan',
        },
      ],
      customer_details: {
        first_name: owner?.namauser || tenant?.namatenant || 'Owner',
        email: owner?.email || tenant?.email || undefined,
        phone: owner?.hp || tenant?.hp || undefined,
      },
      credit_card: {
        secure: true,
      },
      custom_field1: String(ctx.idtenant),
      custom_field2: PLAN_PRO,
    };

    if (process.env.MIDTRANS_FINISH_URL) {
      snapPayload.callbacks = { finish: process.env.MIDTRANS_FINISH_URL };
    }

    const midtrans = await callMidtransSnap(snapPayload);

    await conn.query(
      `UPDATE subscription_payment
       SET midtrans_token = ?, midtrans_redirect_url = ?
       WHERE order_id = ? AND idtenant = ?`,
      [midtrans.token || null, midtrans.redirect_url || null, orderId, ctx.idtenant]
    );

    await logger.history('SUBSCRIPTION_CHECKOUT', {
      idtenant: ctx.idtenant,
      iduser: ctx.iduser,
      ref: orderId,
      detail: { amount },
      req,
    });

    res.status(201).json({
      order_id: orderId,
      token: midtrans.token,
      redirect_url: midtrans.redirect_url,
      amount,
      mode: 'production',
    });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message, midtrans: err.midtrans });
  } finally {
    conn.release();
  }
};

exports.midtransNotification = async (req, res) => {
  const conn = await getConnection();
  try {
    await applyMidtransStatus(conn, req.body || {}, { verifySignature: true, req });
    res.json({ message: 'OK' });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  } finally {
    conn.release();
  }
};

exports.expirePayment = async (req, res) => {
  const conn = await getConnection();
  try {
    const ctx = getTenantContext();
    await ensureSubscriptionSchema();
    await requireOwner(ctx);

    const orderId = req.params.orderId;
    const [[payment]] = await conn.query(
      'SELECT * FROM subscription_payment WHERE order_id = ? AND idtenant = ? LIMIT 1',
      [orderId, ctx.idtenant]
    );
    if (!payment) return res.status(404).json({ message: 'Payment tidak ditemukan' });
    if (payment.status !== 'PENDING') {
      return res.json({ message: 'Payment sudah tidak pending', status: payment.status });
    }

    const midtrans = await expireMidtransTransaction(orderId);
    if (!midtrans.transaction_status) midtrans.transaction_status = 'expire';
    if (!midtrans.order_id) midtrans.order_id = orderId;

    const result = await applyMidtransStatus(conn, midtrans, {
      verifySignature: false,
      idtenant: ctx.idtenant,
      req,
    });

    res.json({ message: 'Payment dibatalkan', status: result.status, midtrans });
  } catch (err) {
    try { await conn.rollback(); } catch (_) {}
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message, midtrans: err.midtrans });
  } finally {
    conn.release();
  }
};

exports.backup = async (req, res) => {
  try {
    const ctx = getTenantContext();
    await ensureSubscriptionSchema();
    await requireOwner(ctx);

    const { isPro } = await getEffectiveSubscription(pool, ctx.idtenant);
    if (!isPro) {
      return res.status(402).json({ message: 'Backup data hanya tersedia untuk subscription PRO' });
    }

    const tenantTables = [
      'tenant', 'lokasi', 'user', 'usermenu', 'userlokasi', 'config',
      'akun', 'customer', 'supplier', 'barang', 'hargajual', 'hargabeli',
      'jual', 'jualdtl', 'beli', 'belidtl', 'kartustok', 'kartupiutang',
      'kartuhutang', 'kas', 'kasdtl', 'jurnal',
    ];

    const backup = {
      exported_at: new Date().toISOString(),
      idtenant: ctx.idtenant,
      tables: {},
    };

    for (const table of tenantTables) {
      if (table === 'user') {
        const [rows] = await pool.query(
          'SELECT iduser, idtenant, username, namauser, email, hp, isowner, tokenversion, status, userentry, tglentry FROM user WHERE idtenant = ?',
          [ctx.idtenant]
        );
        backup.tables[table] = rows;
      } else if (table === 'usermenu') {
        const [rows] = await pool.query(
          `SELECT um.*
           FROM usermenu um
           JOIN user u ON u.iduser = um.iduser
           WHERE u.idtenant = ?`,
          [ctx.idtenant]
        );
        backup.tables[table] = rows;
      } else if (table === 'userlokasi') {
        const [rows] = await pool.query(
          `SELECT ul.*
           FROM userlokasi ul
           JOIN user u ON u.iduser = ul.iduser
           WHERE u.idtenant = ?`,
          [ctx.idtenant]
        );
        backup.tables[table] = rows;
      } else {
        const [rows] = await pool.query(`SELECT * FROM \`${table}\` WHERE idtenant = ?`, [ctx.idtenant]);
        backup.tables[table] = rows;
      }
    }

    const filename = `grfyn-backup-tenant-${ctx.idtenant}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(backup, null, 2));
  } catch (err) {
    logger.error(err, { req });
    res.status(err.statusCode || 500).json({ message: err.message });
  }
};
