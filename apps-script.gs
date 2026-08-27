// body-tracker/apps-script.gs
// 身體追蹤 PWA 後端。部署為 Web App（執行身分：我；存取權：任何人）。
// 安全靠共享密鑰 token：前端與 Garmin 腳本每次呼叫都要帶 ?token=，不對就擋。
// ⚠️ 個人低風險資料用，token 在前端原始碼看得到，勿放敏感個資。

const API_TOKEN = 'body_1rx9a29p2h4z';  // 密鑰，前端 js/api.js 與 GitHub Secret 要一致

const SS_ID = '';  // 留空＝用容器綁定的試算表；若獨立部署填入「身體追蹤」試算表 ID
function ss() { return SS_ID ? SpreadsheetApp.openById(SS_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

const HEADERS = {
  daily: ['date','tdee_total','active_kcal','bmr_kcal','steps','resting_hr','sleep_score','sleep_hours','avg_stress','body_battery'],
  body:  ['date','weight_kg','waist_cm','photo_front','photo_side','photo_back','note','client_id'],
  settings: ['key','value'],
};

function doGet(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
  try {
    if (e.parameter.action === 'getAll')      return jsonOk(getAll());
    if (e.parameter.action === 'getSettings') return jsonOk(getSettings());
    return jsonErr('unknown action');
  } catch (err) { return jsonErr(err.message); }
}

function doPost(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
  const data = JSON.parse(e.postData.contents);
  try {
    if (e.parameter.action === 'addDaily')    return jsonOk(addDaily(data));
    if (e.parameter.action === 'addBody')     return jsonOk(addBody(data));
    if (e.parameter.action === 'setSetting')  return jsonOk(setSetting(data));
    return jsonErr('unknown action');
  } catch (err) { return jsonErr(err.message); }
}

function getOrCreateSheet(name) {
  let sh = ss().getSheetByName(name);
  if (!sh) { sh = ss().insertSheet(name); sh.appendRow(HEADERS[name]); return sh; }
  if (sh.getLastRow() === 0) { sh.appendRow(HEADERS[name]); return sh; }
  // 表頭自癒：欄位定義有變（例如 body 從單張照片升級成正/側/背三張）且尚無資料列時，重寫表頭
  const want = HEADERS[name];
  const have = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
  const same = have.length === want.length && want.every((h, i) => String(have[i]) === String(h));
  if (!same && sh.getLastRow() <= 1) { sh.getRange(1, 1, 1, want.length).setValues([want]); }
  return sh;
}

function readAll(name) {
  const sh = getOrCreateSheet(name);
  const values = sh.getDataRange().getValues();
  const head = values.shift();
  const tz = Session.getScriptTimeZone();
  return values.map(row => {
    const o = {};
    head.forEach((h, i) => {
      const v = row[i];
      o[h] = (v instanceof Date) ? Utilities.formatDate(v, tz, 'yyyy-MM-dd') : v;
    });
    return o;
  });
}

function getAll() {
  return { daily: readAll('daily'), body: readAll('body'), settings: readAll('settings') };
}

// daily 依 date upsert（同日覆蓋），避免排程重跑產生重複列
function addDaily(data) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = getOrCreateSheet('daily');
    const head = HEADERS.daily;
    const row = head.map(h => data[h] != null ? data[h] : '');
    const dates = sh.getRange(2, 1, Math.max(sh.getLastRow() - 1, 0), 1).getValues().flat().map(String);
    const idx = dates.indexOf(String(data.date));
    if (idx >= 0) sh.getRange(idx + 2, 1, 1, head.length).setValues([row]);
    else sh.appendRow(row);
    return { ok: true, upserted: data.date };
  } finally { lock.releaseLock(); }
}

// body 以 client_id 去重（重試安全）。正/側/背三張各自帶 base64 就存 Drive，寫入對應 id
function addBody(data) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = getOrCreateSheet('body');
    const head = HEADERS.body;
    const cidCol = head.indexOf('client_id') + 1;  // client_id 欄位位置（隨欄位定義自動對應）
    if (data.client_id && sh.getLastRow() >= 1) {
      const ids = sh.getRange(1, cidCol, sh.getLastRow(), 1).getValues().flat().map(String);
      if (ids.indexOf(String(data.client_id)) >= 0) return { ok: true, deduped: true };
    }
    // 三個角度：有 base64 就存 Drive 拿 id，否則沿用傳入的既有 id（皆選填）
    const front = data.photo_front_base64 ? savePhoto(data.photo_front_base64, data.date + '_front') : (data.photo_front || '');
    const side  = data.photo_side_base64  ? savePhoto(data.photo_side_base64,  data.date + '_side')  : (data.photo_side  || '');
    const back  = data.photo_back_base64  ? savePhoto(data.photo_back_base64,  data.date + '_back')  : (data.photo_back  || '');
    const rowObj = {
      date: data.date, weight_kg: data.weight_kg || '', waist_cm: data.waist_cm || '',
      photo_front: front, photo_side: side, photo_back: back,
      note: data.note || '', client_id: data.client_id || '',
    };
    sh.appendRow(head.map(h => rowObj[h] != null ? rowObj[h] : ''));
    return { ok: true, photos: { front, side, back } };
  } finally { lock.releaseLock(); }
}

function savePhoto(base64, dateStr) {
  const folderName = 'body-tracker-photos';
  const it = DriveApp.getFoldersByName(folderName);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(folderName);
  const clean = base64.replace(/^data:image\/\w+;base64,/, '');
  const blob = Utilities.newBlob(Utilities.base64Decode(clean), 'image/jpeg', dateStr + '_' + Date.now() + '.jpg');
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getId();
}

function getSettings() {
  const o = {}; readAll('settings').forEach(r => o[r.key] = r.value); return o;
}
function setSetting(data) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = getOrCreateSheet('settings');
    const keys = sh.getRange(1, 1, sh.getLastRow(), 1).getValues().flat().map(String);
    const idx = keys.indexOf(String(data.key));
    if (idx >= 0) sh.getRange(idx + 1, 2).setValue(data.value);
    else sh.appendRow([data.key, data.value]);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

function jsonOk(d) { return ContentService.createTextOutput(JSON.stringify({ ok: true, data: d })).setMimeType(ContentService.MimeType.JSON); }
function jsonErr(m) { return ContentService.createTextOutput(JSON.stringify({ ok: false, error: m })).setMimeType(ContentService.MimeType.JSON); }
