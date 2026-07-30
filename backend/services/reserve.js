const { getConfig, getNumbers, updateNumbers } = require('./firebase');

function padNum(i, total) {
  const padLen = Math.max(3, String(Math.max(0, total - 1)).length);
  return String(i).padStart(padLen, '0');
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function countByPhone(numbers, phoneDigits) {
  let n = 0;
  Object.values(numbers || {}).forEach((d) => {
    if (!d || !d.telefone) return;
    if (String(d.telefone).replace(/\D/g, '') === phoneDigits) n++;
  });
  return n;
}

/**
 * Reserva atômica de cotas.
 * numbers[] opcional; se omitido, escolhe qty aleatórias disponíveis.
 */
async function reserveTickets({
  tenantId,
  rifaId,
  qty,
  numbers: requested,
  nome,
  telefone,
  valorUnidade,
  orderNsu,
  cupom,
  promoDiscount,
  cupomDiscount
}) {
  const config = await getConfig(tenantId, rifaId);
  if (!config) throw Object.assign(new Error('Rifa não encontrada'), { status: 404 });

  const total = parseInt(config.total, 10) || 100;
  const phoneDigits = String(telefone || '').replace(/\D/g, '');
  if (!nome || phoneDigits.length < 10) {
    throw Object.assign(new Error('Nome e WhatsApp inválidos'), { status: 400 });
  }

  const maxPerPerson = parseInt(config.maxCotasPorPessoa, 10) || 0;
  const currentNumbers = await getNumbers(tenantId, rifaId);

  if (maxPerPerson > 0) {
    const already = countByPhone(currentNumbers, phoneDigits);
    const want = requested?.length || qty || 0;
    if (already + want > maxPerPerson) {
      throw Object.assign(
        new Error(`Limite de ${maxPerPerson} cotas por pessoa. Você já tem ${already}.`),
        { status: 400 }
      );
    }
  }

  let selected = [];
  if (Array.isArray(requested) && requested.length > 0) {
    for (const n of requested) {
      const key = String(n).padStart(Math.max(3, String(total - 1).length), '0');
      if (currentNumbers[key]) {
        throw Object.assign(new Error(`Cota ${key} indisponível`), { status: 409 });
      }
      selected.push(key);
    }
  } else {
    const need = parseInt(qty, 10) || 0;
    if (need < 1) throw Object.assign(new Error('Quantidade inválida'), { status: 400 });
    const available = [];
    for (let i = 0; i < total; i++) {
      const n = padNum(i, total);
      if (!currentNumbers[n]) available.push(n);
    }
    if (available.length < need) {
      throw Object.assign(new Error('Não há bilhetes suficientes disponíveis'), { status: 409 });
    }
    selected = shuffle(available).slice(0, need);
  }

  // Re-check race: segunda leitura
  const fresh = await getNumbers(tenantId, rifaId);
  for (const n of selected) {
    if (fresh[n]) {
      throw Object.assign(new Error('Cotas acabaram de ser reservadas. Tente novamente.'), { status: 409 });
    }
  }

  const reservedAt = Date.now();
  const oid = orderNsu || `RN${reservedAt}`;
  const unit = typeof valorUnidade === 'number' ? valorUnidade : parseFloat(config.valor) || 0;

  const updates = {};
  selected.forEach((n) => {
    updates[n] = {
      nome: String(nome).trim(),
      telefone: String(telefone).trim(),
      status: 'reserved',
      order_nsu: oid,
      valor_fixado_unidade: unit,
      reservedAt,
      cupom: cupom || null,
      promo_discount: promoDiscount || 0,
      cupom_discount: cupomDiscount || 0
    };
  });

  await updateNumbers(tenantId, rifaId, updates);

  return {
    orderNsu: oid,
    numbers: selected.sort(),
    reservedAt,
    valorUnidade: unit,
    expiresAt: reservedAt + (Math.max(1, parseInt(config.reservaMinutos, 10) || 15) * 60 * 1000)
  };
}

async function reserveDonation({
  tenantId,
  rifaId,
  nome,
  telefone,
  itemLabel,
  qtyTickets
}) {
  const config = await getConfig(tenantId, rifaId);
  if (!config) throw Object.assign(new Error('Rifa não encontrada'), { status: 404 });

  const total = parseInt(config.total, 10) || 100;
  const phoneDigits = String(telefone || '').replace(/\D/g, '');
  if (!nome || phoneDigits.length < 10) {
    throw Object.assign(new Error('Nome e WhatsApp inválidos'), { status: 400 });
  }

  const need = parseInt(qtyTickets, 10) || 0;
  if (need < 1) throw Object.assign(new Error('Quantidade inválida'), { status: 400 });

  const currentNumbers = await getNumbers(tenantId, rifaId);
  const available = [];
  for (let i = 0; i < total; i++) {
    const n = padNum(i, total);
    if (!currentNumbers[n]) available.push(n);
  }
  if (available.length < need) {
    throw Object.assign(new Error('Não há bilhetes suficientes disponíveis'), { status: 409 });
  }

  const selected = shuffle(available).slice(0, need);
  const fresh = await getNumbers(tenantId, rifaId);
  for (const n of selected) {
    if (fresh[n]) {
      throw Object.assign(new Error('Cotas acabaram de ser reservadas. Tente novamente.'), { status: 409 });
    }
  }

  const oid = `DOA${Date.now()}`;
  const updates = {};
  selected.forEach((n) => {
    updates[n] = {
      nome: String(nome).trim(),
      telefone: String(telefone).trim(),
      status: 'donated_pending',
      order_nsu: oid,
      item_doacao: itemLabel,
      valor_fixado_unidade: 0,
      reservedAt: Date.now()
    };
  });

  await updateNumbers(tenantId, rifaId, updates);
  return { orderNsu: oid, numbers: selected.sort(), itemLabel };
}

/**
 * Libera reservas e doações pendentes expiradas.
 */
async function liberateExpired(tenantId, rifaId) {
  const config = await getConfig(tenantId, rifaId);
  if (!config) return { liberated: 0 };

  const reservaMs = Math.max(1, parseInt(config.reservaMinutos, 10) || 15) * 60 * 1000;
  const doacaoMs =
    Math.max(1, parseInt(config.doacaoExpiraDias, 10) || 7) * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const numbers = await getNumbers(tenantId, rifaId);
  const updates = {};
  let count = 0;

  Object.entries(numbers || {}).forEach(([n, d]) => {
    if (!d || !d.reservedAt) return;
    if (d.status === 'reserved' && now - d.reservedAt > reservaMs) {
      updates[n] = null;
      count++;
    }
    if (d.status === 'donated_pending' && now - d.reservedAt > doacaoMs) {
      updates[n] = null;
      count++;
    }
  });

  if (count > 0) await updateNumbers(tenantId, rifaId, updates);
  return { liberated: count };
}

async function markPaidByNsu(tenantId, rifaId, orderNsu) {
  const numbers = await getNumbers(tenantId, rifaId);
  const updates = {};
  Object.entries(numbers || {}).forEach(([n, d]) => {
    if (d && d.order_nsu === orderNsu && d.status === 'reserved') {
      updates[`${n}/status`] = 'paid';
    }
  });
  if (Object.keys(updates).length === 0) return { updated: 0 };
  await updateNumbers(tenantId, rifaId, updates);
  return { updated: Object.keys(updates).length };
}

async function markPaidByNumbers(tenantId, rifaId, list) {
  const updates = {};
  (list || []).forEach((n) => {
    updates[`${n}/status`] = 'paid';
  });
  if (Object.keys(updates).length === 0) return { updated: 0 };
  await updateNumbers(tenantId, rifaId, updates);
  return { updated: Object.keys(updates).length };
}

module.exports = {
  reserveTickets,
  reserveDonation,
  liberateExpired,
  markPaidByNsu,
  markPaidByNumbers,
  padNum
};
