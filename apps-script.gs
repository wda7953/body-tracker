// body-tracker/apps-script.gs
// 身體追蹤 PWA 後端。部署為 Web App（執行身分：我；存取權：任何人）。
// 安全靠共享密鑰 token：前端與 Garmin 腳本每次呼叫都要帶 ?token=，不對就擋。
// ⚠️ 個人低風險資料用，token 在前端原始碼看得到，勿放敏感個資。

const API_TOKEN = 'CHANGE_ME_body_token';  // 部署前改成你的密鑰，前端 js/api.js 與 GitHub Secret 要一致

const SS_ID = '';  // 留空＝用容器綁定的試算表；若獨立部署填入「身體追蹤」試算表 ID
function ss() { return SS_ID ? SpreadsheetApp.openById(SS_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

const HEADERS = {
  daily: ['date','tdee_total','active_kcal','bmr_kcal','steps','resting_hr','sleep_score','sleep_hours','avg_stress','body_battery'],
  body:  ['date','weight_kg','waist_cm','photo_id','note','client_id'],
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
  if (!sh) { sh = ss().insertSheet(name); sh.appendRow(HEADERS[name]); }
  else if (sh.getLastRow() === 0) { sh.appendRow(HEADERS[name]); }
  return sh;
}

function readAll(name) {
  const sh = getOrCreateSheet(name);
  const values = sh.getDataRange().getValues();
  const head = values.shift();
  return values.map(row => {
    const o = {}; head.forEach((h, i) => o[h] = row[i]); return o;
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

// body 以 client_id 去重（重試安全）。帶 photo_base64 就先存 Drive，寫入 photo_id
function addBody(data) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = getOrCreateSheet('body');
    if (data.client_id) {
      const ids = sh.getRange(1, 6, sh.getLastRow(), 1).getValues().flat().map(String);
      if (ids.indexOf(String(data.client_id)) >= 0) return { ok: true, deduped: true };
    }
    let photoId = data.photo_id || '';
    if (data.photo_base64) photoId = savePhoto(data.photo_base64, String(data.date));
    sh.appendRow([data.date, data.weight_kg || '', data.waist_cm || '', photoId, data.note || '', data.client_id || '']);
    return { ok: true, photo_id: photoId };
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
