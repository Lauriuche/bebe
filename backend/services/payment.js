const { getConfig } = require('./firebase');
const { markPaidByNsu } = require('./reserve');

async function createMercadoPagoPix({ tenantId, rifaId, payData }) {
  const config = await getConfig(tenantId, rifaId);
  if (!config?.mpToken) {
    throw Object.assign(new Error('Mercado Pago não configurado nesta rifa'), { status: 400 });
  }

  const amount = (payData.priceCents || 0) / 100;
  if (amount <= 0) {
    throw Object.assign(new Error('Valor inválido'), { status: 400 });
  }

  const pixMinutes = Math.max(1, parseInt(config.pixMinutos, 10) || 15);
  const expirationDate = new Date(Date.now() + pixMinutes * 60 * 1000).toISOString();

  const body = {
    transaction_amount: Number(amount.toFixed(2)),
    description: payData.description || `Rifa ${config.premio || ''}`,
    payment_method_id: 'pix',
    external_reference: `${tenantId}|${rifaId}|${payData.nsu}`,
    date_of_expiration: expirationDate,
    payer: {
      email: payData.email || `${String(payData.telefone || 'cliente').replace(/\D/g, '')}@rifa.local`,
      first_name: (payData.nome || 'Cliente').split(' ')[0],
      last_name: (payData.nome || '').split(' ').slice(1).join(' ') || 'Rifa'
    },
    metadata: {
      tenantId,
      rifaId,
      order_nsu: payData.nsu,
      telefone: payData.telefone
    }
  };

  const res = await fetch('https://api.mercadopago.com/v1/payments', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.mpToken}`,
      'Content-Type': 'application/json',
      'X-Idempotency-Key': payData.nsu || `${Date.now()}`
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || data?.error || 'Erro Mercado Pago';
    throw Object.assign(new Error(msg), { status: 502, details: data });
  }

  const tx = data.point_of_interaction?.transaction_data || {};
  return {
    id: String(data.id),
    status: data.status,
    qr_code: tx.qr_code || '',
    qr_code_base64: tx.qr_code_base64 || '',
    ticket_url: tx.ticket_url || null,
    external_reference: data.external_reference
  };
}

async function checkMercadoPagoStatus(paymentId, tenantId, rifaId) {
  const config = await getConfig(tenantId, rifaId);
  if (!config?.mpToken) return null;

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${config.mpToken}` }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return { status: data.status, external_reference: data.external_reference, id: data.id };
}

async function generateInfinitePayLink({ payData, handle }) {
  if (!handle) throw Object.assign(new Error('Handle InfinitePay não configurado'), { status: 400 });
  const clean = String(handle).replace(/^@/, '');
  const amount = ((payData.priceCents || 0) / 100).toFixed(2);
  // InfinitePay checkout link pattern (ajuste conforme doc oficial)
  const url = `https://checkout.infinitepay.io/${clean}?amount=${amount}&order_nsu=${encodeURIComponent(payData.nsu || '')}&description=${encodeURIComponent(payData.description || 'Rifa')}`;
  return { url };
}

/**
 * Processa notificação do webhook MP.
 * external_reference: tenantId|rifaId|nsu
 */
async function handleMpWebhookPayload(payload) {
  const action = payload?.action || payload?.type;
  const dataId = payload?.data?.id || payload?.id;
  if (!dataId) return { ok: false, reason: 'no_id' };

  // Sem token global, precisamos do external_reference — buscar payment exige token.
  // O front ainda pode confirmar via check-status; webhook com token por rifa
  // exige que o MP envie a referência ou usamos um token master.
  const masterToken = process.env.MP_WEBHOOK_ACCESS_TOKEN;
  if (!masterToken) {
    return { ok: false, reason: 'MP_WEBHOOK_ACCESS_TOKEN não configurado' };
  }

  const res = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
    headers: { Authorization: `Bearer ${masterToken}` }
  });
  if (!res.ok) return { ok: false, reason: 'mp_fetch_failed' };
  const payment = await res.json();

  if (payment.status !== 'approved') {
    return { ok: true, status: payment.status, updated: 0 };
  }

  const ref = String(payment.external_reference || '');
  const parts = ref.split('|');
  if (parts.length < 3) {
    // fallback metadata
    const meta = payment.metadata || {};
    if (meta.tenantId && meta.rifaId && meta.order_nsu) {
      const r = await markPaidByNsu(meta.tenantId, meta.rifaId, meta.order_nsu);
      return { ok: true, status: 'approved', ...r };
    }
    return { ok: false, reason: 'invalid_reference' };
  }

  const [tenantId, rifaId, nsu] = parts;
  const r = await markPaidByNsu(tenantId, rifaId, nsu);
  return { ok: true, status: 'approved', tenantId, rifaId, nsu, ...r };
}

module.exports = {
  createMercadoPagoPix,
  checkMercadoPagoStatus,
  generateInfinitePayLink,
  handleMpWebhookPayload
};
