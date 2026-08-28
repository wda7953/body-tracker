// body-tracker/js/api.js
// 🔒 隱私版：token（密碼）不再寫在原始碼，改由使用者開 App 時輸入，存在本機瀏覽器 localStorage。
//    公開原始碼裡只有後端網址、沒有密碼；沒密碼的人打開只會看到鎖屏，撈不到任何資料。
const API_URL = 'https://script.google.com/macros/s/AKfycbw2xAshmV1x9tzj2dgR2XKPyX2dHgH1TU6NnLLmYfuP6ffVQwr77MQ77s7LjTHr9WytQA/exec';
const TOKEN_KEY = 'bt_token';  // localStorage 鍵名

function getToken() {
  try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
}
function setToken(t) {
  try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {}
}
function clearToken() {
  try { localStorage.removeItem(TOKEN_KEY); } catch (e) {}
}

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', getToken());
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString());
  return res.json();
}
async function apiPost(action, data) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  url.searchParams.set('token', getToken());
  const res = await fetch(url.toString(), { method: 'POST', body: JSON.stringify(data) });
  return res.json();
}

// 讀一張私有照片，回傳可直接放進 <img src> 的 data URI（後端代理，帶對密碼才給）
async function apiGetPhoto(id) {
  const res = await apiGet('getPhoto', { id });
  return (res && res.ok && res.data) ? res.data.dataUri : '';
}

function genClientId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'c-' + Date.now() + '-' + Math.random().toString(36).slice(2);
}

// ── 鎖屏：沒有有效密碼就擋在門外，三頁共用 ──
function _lockScreen(message) {
  const wrap = document.createElement('div');
  wrap.id = 'bt-lock';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:9999;background:#0b0e12;color:#e6edf3;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:24px;font-family:"Manrope","Noto Sans TC",system-ui,sans-serif;';
  wrap.innerHTML =
    '<div style="font-size:40px">🔒</div>' +
    '<div style="font-size:16px;font-weight:800">身體追蹤 · 請輸入密碼</div>' +
    '<div id="bt-lock-msg" style="font-size:13px;color:#ff6b6b;min-height:18px">' + (message || '') + '</div>' +
    '<input id="bt-lock-pw" type="password" inputmode="text" autocomplete="current-password" placeholder="密碼" ' +
      'style="width:100%;max-width:280px;padding:12px 14px;border-radius:10px;border:1px solid #232c38;background:#161b22;color:#e6edf3;font-size:16px">' +
    '<button id="bt-lock-go" style="width:100%;max-width:280px;padding:12px;border:0;border-radius:10px;background:#00e676;color:#052e16;font-size:15px;font-weight:800">解鎖</button>';
  document.body.appendChild(wrap);
  const pw = wrap.querySelector('#bt-lock-pw');
  const msg = wrap.querySelector('#bt-lock-msg');
  const go = wrap.querySelector('#bt-lock-go');
  const submit = async () => {
    const val = pw.value.trim();
    if (!val) return;
    setToken(val);
    msg.textContent = '驗證中…'; msg.style.color = '#7d8896';
    const res = await apiGet('getSettings');       // 拿密碼打一個輕量端點驗證
    if (res && res.ok) { wrap.remove(); location.reload(); }   // 對了：存起來、重載進 App
    else { clearToken(); msg.style.color = '#ff6b6b'; msg.textContent = '密碼不對，再試一次'; pw.value = ''; pw.focus(); }
  };
  go.addEventListener('click', submit);
  pw.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  setTimeout(() => pw.focus(), 100);
}

// App 進入點：確認手上的密碼有效，無效就鎖屏。三頁在載入資料前先 await requireAuth()
async function requireAuth() {
  if (!getToken()) { _lockScreen(''); return false; }
  const res = await apiGet('getSettings');
  if (res && res.ok) return true;
  clearToken(); _lockScreen('密碼已失效，請重新輸入'); return false;
}

window.API = { apiGet, apiPost, apiGetPhoto, genClientId, requireAuth, clearToken };
