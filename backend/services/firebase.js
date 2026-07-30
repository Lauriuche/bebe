const admin = require('firebase-admin');

let db = null;

function initFirebase() {
  if (db) return db;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!projectId || !clientEmail || !privateKey || !databaseURL) {
    console.warn('[firebase] Credenciais incompletas. Modo degradado (sem Admin SDK).');
    return null;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      databaseURL
    });
  }

  db = admin.database();
  return db;
}

function dbPath(tenantId, rifaId) {
  if (!tenantId || tenantId === 'rifa_master') {
    return rifaId && rifaId !== 'padrao' ? `tenants/rifa_master/rifas/${rifaId}` : 'rifa_master';
  }
  return `tenants/${tenantId}/rifas/${rifaId || 'padrao'}`;
}

function getDb() {
  return initFirebase();
}

async function getConfig(tenantId, rifaId) {
  const database = getDb();
  if (!database) return null;
  const snap = await database.ref(`${dbPath(tenantId, rifaId)}/config`).once('value');
  return snap.exists() ? snap.val() : null;
}

async function getNumbers(tenantId, rifaId) {
  const database = getDb();
  if (!database) return {};
  const snap = await database.ref(`${dbPath(tenantId, rifaId)}/numeros`).once('value');
  return snap.exists() ? snap.val() : {};
}

async function updateNumbers(tenantId, rifaId, updates) {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado');
  await database.ref(`${dbPath(tenantId, rifaId)}/numeros`).update(updates);
}

async function setGanhador(tenantId, rifaId, premioIndex, data) {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado');
  await database.ref(`${dbPath(tenantId, rifaId)}/ganhadores/${premioIndex}`).set(data);
}

async function removeNumbers(tenantId, rifaId) {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado');
  await database.ref(`${dbPath(tenantId, rifaId)}/numeros`).remove();
  await database.ref(`${dbPath(tenantId, rifaId)}/ganhadores`).remove();
}

async function setConfigSafe(tenantId, rifaId, config) {
  const database = getDb();
  if (!database) throw new Error('Firebase não configurado');
  // Nunca sobrescreve secrets se vierem vazios do client
  const current = await getConfig(tenantId, rifaId);
  const merged = { ...(current || {}), ...config };
  if (!config.mpToken && current?.mpToken) merged.mpToken = current.mpToken;
  if (!config.pin && current?.pin) merged.pin = current.pin;
  await database.ref(`${dbPath(tenantId, rifaId)}/config`).set(merged);
  return merged;
}

/** Config pública (sem secrets) */
function publicConfig(cfg) {
  if (!cfg) return null;
  const { mpToken, pin, ...safe } = cfg;
  return {
    ...safe,
    hasMpToken: !!(mpToken && String(mpToken).length > 10),
    hasPin: !!(pin && String(pin).length > 0)
  };
}

module.exports = {
  initFirebase,
  getDb,
  dbPath,
  getConfig,
  getNumbers,
  updateNumbers,
  setGanhador,
  removeNumbers,
  setConfigSafe,
  publicConfig
};
