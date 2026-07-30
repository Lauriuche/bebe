const express = require('express');
const router = express.Router();
const { adminLogin, requireAdmin } = require('../middleware/auth');
const {
  getConfig,
  publicConfig,
  getNumbers,
  updateNumbers,
  removeNumbers,
  setConfigSafe
} = require('../services/firebase');
const {
  reserveTickets,
  reserveDonation,
  liberateExpired,
  markPaidByNsu,
  markPaidByNumbers
} = require('../services/reserve');
const {
  createMercadoPagoPix,
  checkMercadoPagoStatus,
  generateInfinitePayLink,
  handleMpWebhookPayload
} = require('../services/payment');
const { performDraw } = require('../services/draw');

function tenantFrom(req) {
  return {
    tenantId: req.body?.tenantId || req.query?.tenantId || 'rifa_master',
    rifaId: req.body?.rifaId || req.query?.rifaId || 'padrao'
  };
}

// ——— Público ———

router.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

router.get('/config', async (req, res) => {
  try {
    const { tenantId, rifaId } = tenantFrom(req);
    const cfg = await getConfig(tenantId, rifaId);
    res.json(publicConfig(cfg) || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/reserve', async (req, res) => {
  try {
    const { tenantId, rifaId } = tenantFrom(req);
    const result = await reserveTickets({ tenantId, rifaId, ...req.body });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/reserve-donation', async (req, res) => {
  try {
    const { tenantId, rifaId } = tenantFrom(req);
    const result = await reserveDonation({ tenantId, rifaId, ...req.body });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/create-pix', async (req, res) => {
  try {
    const { tenantId, rifaId, payData } = req.body || {};
    // Token NUNCA vem do client — só do Firebase config no server
    const result = await createMercadoPagoPix({
      tenantId: tenantId || 'rifa_master',
      rifaId: rifaId || 'padrao',
      payData
    });
    res.json(result);
  } catch (e) {
    console.error('[create-pix]', e);
    res.status(e.status || 500).json({ error: e.message, details: e.details });
  }
});

router.get('/check-status/:paymentId', async (req, res) => {
  try {
    const { tenantId, rifaId } = tenantFrom(req);
    const data = await checkMercadoPagoStatus(req.params.paymentId, tenantId, rifaId);
    if (!data) return res.status(404).json({ error: 'Pagamento não encontrado' });

    if (data.status === 'approved' && data.external_reference) {
      const parts = String(data.external_reference).split('|');
      if (parts.length >= 3) {
        await markPaidByNsu(parts[0], parts[1], parts[2]);
      }
    }
    res.json({ status: data.status });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/create-infinitepay', async (req, res) => {
  try {
    const { payData, handle, tenantId, rifaId } = req.body || {};
    let h = handle;
    if (!h) {
      const cfg = await getConfig(tenantId || 'rifa_master', rifaId || 'padrao');
      h = cfg?.handle;
    }
    const result = await generateInfinitePayLink({ payData, handle: h });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.post('/webhook/mercadopago', async (req, res) => {
  try {
    const result = await handleMpWebhookPayload(req.body || {});
    console.log('[webhook/mp]', result);
    res.status(200).json(result);
  } catch (e) {
    console.error('[webhook/mp]', e);
    res.status(200).json({ ok: false, error: e.message });
  }
});

router.post('/liberate-expired', async (req, res) => {
  try {
    const { tenantId, rifaId } = tenantFrom(req);
    const result = await liberateExpired(tenantId, rifaId);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ——— Admin ———

router.post('/admin/login', adminLogin);

router.post('/admin/confirm', requireAdmin, async (req, res) => {
  try {
    const { tenantId, rifaId } = req.admin;
    const { telefone, action } = req.body || {};
    const numbers = await getNumbers(tenantId, rifaId);
    const updates = {};
    Object.entries(numbers || {}).forEach(([n, d]) => {
      if (d && d.telefone === telefone) {
        const isDoacao = !!d.item_doacao;
        if (action === 'confirmado') {
          updates[`${n}/status`] = isDoacao ? 'donated' : 'paid';
        } else if (action === 'pendente') {
          updates[`${n}/status`] = isDoacao ? 'donated_pending' : 'reserved';
        }
      }
    });
    if (Object.keys(updates).length) await updateNumbers(tenantId, rifaId, updates);
    res.json({ updated: Object.keys(updates).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/delete-participant', requireAdmin, async (req, res) => {
  try {
    const { tenantId, rifaId } = req.admin;
    const { telefone } = req.body || {};
    const numbers = await getNumbers(tenantId, rifaId);
    const updates = {};
    Object.entries(numbers || {}).forEach(([n, d]) => {
      if (d && d.telefone === telefone) updates[n] = null;
    });
    if (Object.keys(updates).length) await updateNumbers(tenantId, rifaId, updates);
    res.json({ deleted: Object.keys(updates).length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/reset', requireAdmin, async (req, res) => {
  try {
    const { tenantId, rifaId } = req.admin;
    await removeNumbers(tenantId, rifaId);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/draw', requireAdmin, async (req, res) => {
  try {
    const { tenantId, rifaId } = req.admin;
    const { premioIndex, premioDesc } = req.body || {};
    const result = await performDraw({
      tenantId,
      rifaId,
      premioIndex: parseInt(premioIndex, 10) || 0,
      premioDesc
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.get('/admin/export', requireAdmin, async (req, res) => {
  try {
    const { tenantId, rifaId } = req.admin;
    const numbers = await getNumbers(tenantId, rifaId);
    const rows = [['Cota', 'Nome', 'Telefone', 'Status', 'Item Doacao', 'NSU', 'Valor Unidade', 'Cupom', 'Reservado Em']];
    Object.entries(numbers || {}).forEach(([n, d]) => {
      rows.push([
        n,
        d.nome || '',
        d.telefone || '',
        d.status || '',
        d.item_doacao || '',
        d.order_nsu || '',
        d.valor_fixado_unidade !== undefined ? d.valor_fixado_unidade : '',
        d.cupom || '',
        d.reservedAt ? new Date(d.reservedAt).toISOString() : ''
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=rifa_${Date.now()}.csv`);
    res.send('\uFEFF' + csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const { tenantId, rifaId } = req.admin;
    const numbers = await getNumbers(tenantId, rifaId);
    const config = await getConfig(tenantId, rifaId);
    let receita = 0;
    let doacoes = 0;
    let reserved = 0;
    let paid = 0;
    const byDay = {};

    Object.values(numbers || {}).forEach((d) => {
      if (!d) return;
      const val = parseFloat(d.valor_fixado_unidade);
      const v = Number.isFinite(val) ? val : parseFloat(config?.valor) || 0;
      if (d.status === 'paid') {
        paid++;
        receita += v;
        const day = d.reservedAt ? new Date(d.reservedAt).toISOString().slice(0, 10) : 'unknown';
        byDay[day] = byDay[day] || { paid: 0, receita: 0 };
        byDay[day].paid++;
        byDay[day].receita += v;
      }
      if (d.status === 'reserved') reserved++;
      if (d.status === 'donated' || d.status === 'donated_pending') doacoes++;
    });

    const totalCotas = Object.keys(numbers || {}).length;
    const conv = reserved + paid > 0 ? paid / (reserved + paid) : 0;

    res.json({
      receita,
      doacoes,
      cotas: totalCotas,
      paid,
      reserved,
      conversaoReservaPago: Math.round(conv * 1000) / 10,
      ticketMedio: paid > 0 ? Math.round((receita / paid) * 100) / 100 : 0,
      byDay
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/admin/save-config', requireAdmin, async (req, res) => {
  try {
    const { tenantId, rifaId } = req.admin;
    const body = { ...(req.body || {}) };
    delete body.tenantId;
    delete body.rifaId;
    // Secrets: se string vazia, não sobrescreve
    if (body.mpToken === '') delete body.mpToken;
    if (body.pin === '') delete body.pin;
    const merged = await setConfigSafe(tenantId, rifaId, body);
    res.json(publicConfig(merged));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/pay-existing-mark-nsu', async (req, res) => {
  try {
    const { tenantId, rifaId, numbers: list, orderNsu } = req.body || {};
    const updates = {};
    (list || []).forEach((n) => {
      updates[`${n}/order_nsu`] = orderNsu;
    });
    if (Object.keys(updates).length) {
      await updateNumbers(tenantId || 'rifa_master', rifaId || 'padrao', updates);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
