const crypto = require('crypto');
const { getConfig, getNumbers, setGanhador } = require('./firebase');
const { padNum } = require('./reserve');

/**
 * Sorteio auditável: seed = hash(timestamp + sorted valid tickets + salt)
 */
async function performDraw({ tenantId, rifaId, premioIndex, premioDesc }) {
  const config = await getConfig(tenantId, rifaId);
  if (!config) throw Object.assign(new Error('Rifa não encontrada'), { status: 404 });

  const numbers = await getNumbers(tenantId, rifaId);
  const validos = Object.entries(numbers || {}).filter(
    ([, d]) => d && (d.status === 'paid' || d.status === 'donated')
  );

  if (validos.length === 0) {
    throw Object.assign(new Error('Nenhum bilhete confirmado para sortear'), { status: 400 });
  }

  const sortedKeys = validos.map(([n]) => n).sort();
  const timestamp = Date.now();
  const salt = process.env.DRAW_SALT || 'rifa-master';
  const seedMaterial = `${timestamp}|${sortedKeys.join(',')}|${salt}|${premioIndex}`;
  const hash = crypto.createHash('sha256').update(seedMaterial).digest('hex');
  const hashInt = parseInt(hash.slice(0, 12), 16);
  const idx = hashInt % validos.length;
  const [numeroSorteado, info] = validos[idx];

  const total = parseInt(config.total, 10) || 100;
  const cota = String(numeroSorteado).padStart(Math.max(3, String(total - 1).length), '0');

  const record = {
    nome: info.nome,
    telefone: info.telefone,
    cota,
    premioIndex,
    premioDesc: premioDesc || `Prêmio ${premioIndex + 1}`,
    data: timestamp,
    audit: {
      seedHash: hash,
      poolSize: validos.length,
      index: idx,
      algorithm: 'sha256-mod'
    }
  };

  await setGanhador(tenantId, rifaId, premioIndex, record);
  return record;
}

module.exports = { performDraw };
