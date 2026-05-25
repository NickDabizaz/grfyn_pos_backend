const { pool } = require('../../config/db');
const { ensureSubscriptionSchema } = require('../../lib/subscription');
const logger = require('../../lib/logger');

exports.index = async (req, res) => {
  try {
    await ensureSubscriptionSchema();

    const [tenants] = await pool.query(`
      SELECT
        t.idtenant,
        t.namatenant,
        t.hp,
        t.status,
        t.subscription_plan,
        t.subscription_status,
        t.subscription_started_at,
        t.subscription_expires_at,
        (SELECT COUNT(*) FROM user WHERE idtenant = t.idtenant AND status = 'AKTIF') AS active_users,
        (SELECT COUNT(*) FROM subscription_payment WHERE idtenant = t.idtenant AND status = 'PAID') AS paid_count,
        (SELECT MAX(paid_at) FROM subscription_payment WHERE idtenant = t.idtenant AND status = 'PAID') AS last_paid_at
      FROM tenant t
      ORDER BY
        FIELD(t.subscription_plan, 'PRO', 'FREE'),
        t.idtenant
    `);

    const now = new Date();
    const enriched = tenants.map((t) => {
      const isPro = t.subscription_plan === 'PRO';
      const expiresAt = t.subscription_expires_at ? new Date(t.subscription_expires_at) : null;
      const isExpired = isPro && expiresAt && expiresAt < now;
      const daysLeft = isPro && expiresAt ? Math.ceil((expiresAt - now) / 86400000) : null;
      return { ...t, isPro, isExpired, daysLeft };
    });

    const summary = {
      total: enriched.length,
      pro: enriched.filter((t) => t.isPro && !t.isExpired).length,
      free: enriched.filter((t) => !t.isPro || t.isExpired).length,
      expired: enriched.filter((t) => t.isExpired).length,
    };

    res.render('layout', {
      view: 'subscriptions',
      title: 'Subscription Management',
      active: 'subscriptions',
      tenants: enriched,
      summary,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    logger.error(err, { req });
    res.render('layout', {
      view: 'subscriptions',
      title: 'Subscription Management',
      active: 'subscriptions',
      tenants: [],
      summary: { total: 0, pro: 0, free: 0, expired: 0 },
      error: err.message,
    });
  }
};

exports.setSubscription = async (req, res) => {
  const { idtenant, plan, duration_days, custom_expires_at } = req.body;
  const tid = parseInt(idtenant, 10);

  if (!tid || tid <= 0) {
    return res.redirect('/developer/subscriptions?error=Invalid+tenant+ID');
  }

  const planUpper = String(plan || '').toUpperCase();
  if (!['FREE', 'PRO'].includes(planUpper)) {
    return res.redirect('/developer/subscriptions?error=Invalid+plan');
  }

  try {
    await ensureSubscriptionSchema();
    const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ? LIMIT 1', [tid]);
    if (!tenant) return res.redirect('/developer/subscriptions?error=Tenant+not+found');

    if (planUpper === 'FREE') {
      await pool.query(
        `UPDATE tenant SET
          subscription_plan = 'FREE',
          subscription_status = 'ACTIVE',
          subscription_started_at = NULL,
          subscription_expires_at = NULL
         WHERE idtenant = ?`,
        [tid]
      );
      await logger.history('DEV_SUBSCRIPTION_SET_FREE', {
        idtenant: tid,
        ref: `tenant-${tid}`,
        detail: { action: 'manual_set_free', tenant: tenant.namatenant },
        req,
      });
      return res.redirect('/developer/subscriptions?success=Tenant+set+to+FREE');
    }

    // PRO
    let expiresAt;
    if (custom_expires_at) {
      expiresAt = new Date(custom_expires_at);
      if (isNaN(expiresAt.getTime())) {
        return res.redirect('/developer/subscriptions?error=Invalid+expiry+date');
      }
    } else {
      const days = parseInt(duration_days, 10) || 30;
      expiresAt = new Date(Date.now() + days * 86400000);
    }

    const now = new Date();
    await pool.query(
      `UPDATE tenant SET
        subscription_plan = 'PRO',
        subscription_status = 'ACTIVE',
        subscription_started_at = ?,
        subscription_expires_at = ?
       WHERE idtenant = ?`,
      [now, expiresAt, tid]
    );

    await logger.history('DEV_SUBSCRIPTION_SET_PRO', {
      idtenant: tid,
      ref: `tenant-${tid}`,
      detail: {
        action: 'manual_set_pro',
        tenant: tenant.namatenant,
        expires_at: expiresAt.toISOString(),
      },
      req,
    });

    return res.redirect('/developer/subscriptions?success=Tenant+activated+as+PRO');
  } catch (err) {
    logger.error(err, { req });
    return res.redirect(`/developer/subscriptions?error=${encodeURIComponent(err.message)}`);
  }
};

exports.tenantDetail = async (req, res) => {
  const tid = parseInt(req.params.idtenant, 10);
  if (!tid || tid <= 0) {
    return res.redirect('/developer/subscriptions?error=Invalid+tenant+ID');
  }

  try {
    await ensureSubscriptionSchema();

    const [[tenant]] = await pool.query(
      `SELECT t.*,
        (SELECT COUNT(*) FROM user WHERE idtenant = t.idtenant AND status = 'AKTIF') AS active_users
       FROM tenant t WHERE t.idtenant = ? LIMIT 1`,
      [tid]
    );
    if (!tenant) return res.redirect('/developer/subscriptions?error=Tenant+not+found');

    const [payments] = await pool.query(
      `SELECT * FROM subscription_payment WHERE idtenant = ? ORDER BY idpayment DESC LIMIT 20`,
      [tid]
    );

    const now = new Date();
    const isPro = tenant.subscription_plan === 'PRO';
    const expiresAt = tenant.subscription_expires_at ? new Date(tenant.subscription_expires_at) : null;
    const isExpired = isPro && expiresAt && expiresAt < now;
    const daysLeft = isPro && expiresAt ? Math.ceil((expiresAt - now) / 86400000) : null;

    res.render('layout', {
      view: 'subscription-detail',
      title: `Subscription - ${tenant.namatenant}`,
      active: 'subscriptions',
      tenant: { ...tenant, isPro, isExpired, daysLeft },
      payments,
      success: req.query.success || null,
      error: req.query.error || null,
    });
  } catch (err) {
    logger.error(err, { req });
    return res.redirect(`/developer/subscriptions?error=${encodeURIComponent(err.message)}`);
  }
};

exports.extendSubscription = async (req, res) => {
  const tid = parseInt(req.params.idtenant, 10);
  const { extend_days } = req.body;
  const days = parseInt(extend_days, 10) || 30;

  if (!tid || tid <= 0) {
    return res.redirect('/developer/subscriptions?error=Invalid+tenant+ID');
  }

  try {
    await ensureSubscriptionSchema();
    const [[tenant]] = await pool.query('SELECT * FROM tenant WHERE idtenant = ? LIMIT 1', [tid]);
    if (!tenant) return res.redirect('/developer/subscriptions?error=Tenant+not+found');

    const currentExpiry = tenant.subscription_expires_at ? new Date(tenant.subscription_expires_at) : new Date();
    const base = currentExpiry > new Date() ? currentExpiry : new Date();
    const newExpiry = new Date(base.getTime() + days * 86400000);

    await pool.query(
      `UPDATE tenant SET
        subscription_plan = 'PRO',
        subscription_status = 'ACTIVE',
        subscription_expires_at = ?
       WHERE idtenant = ?`,
      [newExpiry, tid]
    );

    await logger.history('DEV_SUBSCRIPTION_EXTEND', {
      idtenant: tid,
      ref: `tenant-${tid}`,
      detail: { action: 'manual_extend', days, new_expires_at: newExpiry.toISOString() },
      req,
    });

    return res.redirect(`/developer/subscriptions/${tid}?success=Subscription+extended+${days}+days`);
  } catch (err) {
    logger.error(err, { req });
    return res.redirect(`/developer/subscriptions/${tid}?error=${encodeURIComponent(err.message)}`);
  }
};
