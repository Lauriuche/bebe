/**
 * Cliente HTTP do backend Rifa Master v2.
 * Se BACKEND_URL estiver offline, os callers tratam o erro / fallback.
 */
const BACKEND_URL = (typeof window !== 'undefined' && window.RIFA_BACKEND_URL)
  || 'https://rifa-1-m8tv.onrender.com';

function getTenantParams() {
  const urlParams = new URLSearchParams(window.location.search);
  return {
    tenantId: urlParams.get('tenant') || 'rifa_master',
    rifaId: urlParams.get('rifa') || 'padrao'
  };
}

function adminToken() {
  return sessionStorage.getItem('rifa_admin_token') || '';
}

async function request(path, options = {}) {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  if (options.auth) {
    const t = adminToken();
    if (t) headers.Authorization = `Bearer ${t}`;
  }
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  let data = null;
  const text = await res.text();
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || data?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const Api = {
  BACKEND_URL,
  getTenantParams,
  adminToken,
  setAdminToken(token) {
    if (token) sessionStorage.setItem('rifa_admin_token', token);
    else sessionStorage.removeItem('rifa_admin_token');
  },

  health: () => request('/api/health'),

  createPix(payData) {
    const { tenantId, rifaId } = getTenantParams();
    return request('/api/create-pix', {
      method: 'POST',
      body: { tenantId, rifaId, payData }
    });
  },

  checkStatus(paymentId) {
    const { tenantId, rifaId } = getTenantParams();
    return request(`/api/check-status/${paymentId}?tenantId=${tenantId}&rifaId=${rifaId}`);
  },

  createInfinitePay(payData, handle) {
    const { tenantId, rifaId } = getTenantParams();
    return request('/api/create-infinitepay', {
      method: 'POST',
      body: { tenantId, rifaId, payData, handle }
    });
  },

  reserve(payload) {
    const { tenantId, rifaId } = getTenantParams();
    return request('/api/reserve', {
      method: 'POST',
      body: { tenantId, rifaId, ...payload }
    });
  },

  reserveDonation(payload) {
    const { tenantId, rifaId } = getTenantParams();
    return request('/api/reserve-donation', {
      method: 'POST',
      body: { tenantId, rifaId, ...payload }
    });
  },

  liberateExpired() {
    const { tenantId, rifaId } = getTenantParams();
    return request('/api/liberate-expired', {
      method: 'POST',
      body: { tenantId, rifaId }
    });
  },

  adminLogin(pin) {
    const { tenantId, rifaId } = getTenantParams();
    return request('/api/admin/login', {
      method: 'POST',
      body: { tenantId, rifaId, pin }
    });
  },

  adminConfirm(telefone, action) {
    return request('/api/admin/confirm', {
      method: 'POST',
      auth: true,
      body: { telefone, action }
    });
  },

  adminDelete(telefone) {
    return request('/api/admin/delete-participant', {
      method: 'POST',
      auth: true,
      body: { telefone }
    });
  },

  adminReset() {
    return request('/api/admin/reset', { method: 'POST', auth: true, body: {} });
  },

  adminDraw(premioIndex, premioDesc) {
    return request('/api/admin/draw', {
      method: 'POST',
      auth: true,
      body: { premioIndex, premioDesc }
    });
  },

  adminStats() {
    return request('/api/admin/stats', { method: 'GET', auth: true });
  },

  adminSaveConfig(config) {
    return request('/api/admin/save-config', {
      method: 'POST',
      auth: true,
      body: config
    });
  },

  payExistingMarkNsu(numbers, orderNsu) {
    const { tenantId, rifaId } = getTenantParams();
    return request('/api/pay-existing-mark-nsu', {
      method: 'POST',
      body: { tenantId, rifaId, numbers, orderNsu }
    });
  }
};

export default Api;
