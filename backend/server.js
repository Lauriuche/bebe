/**
 * Rifa Master API v2
 * Deploy no Render: set env vars e start command `node server.js`
 *
 * ENV obrigatórias:
 *   FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL
 *   JWT_SECRET
 * Opcionais:
 *   MP_WEBHOOK_ACCESS_TOKEN, DRAW_SALT, PORT, CORS_ORIGIN
 *   TENANTS_CRON (csv tenant:rifa, default rifa_master:padrao)
 */
const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const api = require('./routes/api');
const { initFirebase } = require('./services/firebase');
const { liberateExpired } = require('./services/reserve');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(
  cors({
    origin: process.env.CORS_ORIGIN || true,
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));

app.use('/api', api);

// Compat com frontend antigo
app.post('/api/create-pix', (req, res, next) => {
  req.url = '/create-pix';
  api(req, res, next);
});

app.get('/', (_req, res) => {
  res.json({
    name: 'Rifa Master API',
    version: '2.0.0',
    health: '/api/health'
  });
});

initFirebase();

// Cron: libera reservas expiradas a cada 2 minutos
const tenantsCron = (process.env.TENANTS_CRON || 'rifa_master:padrao')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

cron.schedule('*/2 * * * *', async () => {
  for (const pair of tenantsCron) {
    const [tenantId, rifaId] = pair.split(':');
    try {
      const r = await liberateExpired(tenantId || 'rifa_master', rifaId || 'padrao');
      if (r.liberated > 0) {
        console.log(`[cron] ${tenantId}/${rifaId} liberou ${r.liberated} cotas`);
      }
    } catch (e) {
      console.error('[cron]', pair, e.message);
    }
  }
});

app.listen(PORT, () => {
  console.log(`Rifa Master API v2 on :${PORT}`);
});
