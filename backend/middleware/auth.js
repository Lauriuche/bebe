const jwt = require('jsonwebtoken');
const { getConfig } = require('../services/firebase');

const JWT_SECRET = process.env.JWT_SECRET || 'change-me-in-production-rifa-master';
const JWT_EXPIRES = process.env.JWT_EXPIRES || '8h';

async function adminLogin(req, res) {
  try {
    const { tenantId = 'rifa_master', rifaId = 'padrao', pin } = req.body || {};
    if (!pin) return res.status(400).json({ error: 'PIN obrigatório' });

    const config = await getConfig(tenantId, rifaId);
    if (!config) return res.status(404).json({ error: 'Rifa não encontrada' });

    const correct = String(config.pin || '').trim();
    if (!correct || String(pin).trim() !== correct) {
      return res.status(401).json({ error: 'PIN incorreto' });
    }

    const token = jwt.sign({ role: 'admin', tenantId, rifaId }, JWT_SECRET, {
      expiresIn: JWT_EXPIRES
    });

    return res.json({ token, expiresIn: JWT_EXPIRES });
  } catch (e) {
    console.error('[adminLogin]', e);
    return res.status(500).json({ error: e.message || 'Erro interno' });
  }
}

function requireAdmin(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Não autenticado' });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    if (payload.role !== 'admin') return res.status(403).json({ error: 'Acesso negado' });
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}

module.exports = { adminLogin, requireAdmin, JWT_SECRET };
