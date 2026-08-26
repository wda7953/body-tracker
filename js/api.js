// body-tracker/js/api.js
const API_URL = 'PASTE_APPS_SCRIPT_EXEC_URL';  // 部署後填入
const API_TOKEN = 'CHANGE_ME_body_token';       // 與後端 apps-script.gs 一致

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}
async function apiPost(action, data) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', API_TOKEN);
  const res = await fetch(url.toString(), { method: 'POST', body: JSON.stringify(data) });
  return res.json();
}
function genClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}
window.API = { apiGet, apiPost, genClientId };
