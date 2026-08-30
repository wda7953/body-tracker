// body-tracker/apps-script.gs
// 身體追蹤 PWA 後端。部署為 Web App（執行身分：我；存取權：任何人）。
// 安全靠共享密鑰 token：前端每次呼叫都要帶 ?token=，不對就擋。
// 🔒 隱私強化版：照片存 Drive 為「私有」，只能透過本後端帶對 token 才讀得到（getPhoto 代理）。
//    token 不再寫在前端原始碼，改由使用者開 App 時輸入、存在瀏覽器；公開原始碼看不到密碼。

// ★★★ 這裡改成你自己的密碼（12 字以上、英數混合，別人猜不到）。與前端登入、GitHub Secret 要一致 ★★★
const API_TOKEN = '★改成你的密碼★';

const SS_ID = '';  // 留空＝用容器綁定的試算表；若獨立部署填入「身體追蹤」試算表 ID
function ss() { return SS_ID ? SpreadsheetApp.openById(SS_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

const PHOTO_FOLDER = 'body-tracker-photos';  // 照片資料夾名稱（私有）

const HEADERS = {
  daily: ['date','tdee_total','active_kcal','bmr_kcal','steps','resting_hr','sleep_score','sleep_hours','avg_stress','body_battery','training_readiness','hrv_last_night','hrv_status'],
  body:  ['date','weight_kg','waist_cm','photo_front','photo_side','photo_back','note','client_id'],
  cycle: ['date','client_id'],   // 生理期「開始日」（每次來的第一天）；期間長度/週期天數放 settings
  settings: ['key','value'],
};

function doGet(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
  try {
    if (e.parameter.action === 'getAll')      return jsonOk(getAll());
    if (e.parameter.action === 'getSettings') return jsonOk(getSettings());
    if (e.parameter.action === 'getPhoto')    return jsonOk(getPhoto(e.parameter.id));  // 代理讀私有照片
    return jsonErr('unknown action');
  } catch (err) { return jsonErr(err.message); }
}

function doPost(e) {
  if (e.parameter.token !== API_TOKEN) return jsonErr('unauthorized');
  const data = JSON.parse(e.postData.contents);
  try {
    if (e.parameter.action === 'addDaily')    return jsonOk(addDaily(data));
    if (e.parameter.action === 'addBody')     return jsonOk(addBody(data));
    if (e.parameter.action === 'addCycle')    return jsonOk(addCycle(data));
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
  return { daily: readAll('daily'), body: readAll('body'), cycle: readAll('cycle'), settings: readAll('settings') };
}

// daily 依 date upsert（同日覆蓋），避免排程重跑產生重複列
function addDaily(data) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = getOrCreateSheet('daily');
    const head = HEADERS.daily;
    const row = head.map(h => data[h] != null ? data[h] : '');
    const last = sh.getLastRow();
    // 只有表頭（last<2）時沒有資料列可讀，直接視為找不到、走 append（getRange 列數不得為 0）
    const dates = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().flat().map(String) : [];
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

// cycle：記錄生理期「開始日」。以 client_id 去重（重試安全）；同一天已有紀錄也視為已記錄（避免同日重複點）
function addCycle(data) {
  const lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    const sh = getOrCreateSheet('cycle');
    const head = HEADERS.cycle;
    const cidCol = head.indexOf('client_id'), dateCol = head.indexOf('date');
    if (sh.getLastRow() >= 2) {
      const rows = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
      const tz = Session.getScriptTimeZone();
      for (const r of rows) {
        if (data.client_id && String(r[cidCol]) === String(data.client_id)) return { ok: true, deduped: true };
        const rd = (r[dateCol] instanceof Date) ? Utilities.formatDate(r[dateCol], tz, 'yyyy-MM-dd') : String(r[dateCol]);
        if (rd === String(data.date)) return { ok: true, deduped: 'same-date' };
      }
    }
    sh.appendRow(head.map(h => data[h] != null ? data[h] : ''));
    return { ok: true, added: data.date };
  } finally { lock.releaseLock(); }
}

function photoFolder() {
  const it = DriveApp.getFoldersByName(PHOTO_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER);
}

function savePhoto(base64, dateStr) {
  const clean = base64.replace(/^data:image\/\w+;base64,/, '');
  const blob = Utilities.newBlob(Utilities.base64Decode(clean), 'image/jpeg', dateStr + '_' + Date.now() + '.jpg');
  const file = photoFolder().createFile(blob);
  // 🔒 私有：不設任何公開分享。檔案只有本後端（以你的身分執行）能讀。
  return file.getId();
}

// 代理讀圖：帶對 token 才會走到這（doGet 已驗）。回傳 base64 data URI，前端塞進 <img>
function getPhoto(id) {
  if (!id) return { dataUri: '' };
  const file = DriveApp.getFileById(id);
  const blob = file.getBlob();
  const b64 = Utilities.base64Encode(blob.getBytes());
  return { dataUri: 'data:' + blob.getContentType() + ';base64,' + b64 };
}

// ── 一次性維護：把資料夾內所有舊照片改回私有（撤銷之前的「任何人有連結可看」）──
// 用法：在 Apps Script 編輯器上方函式下拉選 revokeAllPhotoSharing → 執行一次即可。
function revokeAllPhotoSharing() {
  const files = photoFolder().getFiles();
  let n = 0;
  while (files.hasNext()) {
    const f = files.next();
    try { f.setSharing(DriveApp.Access.PRIVATE, DriveApp.Permission.NONE); n++; }
    catch (err) { Logger.log('skip ' + f.getName() + ': ' + err.message); }
  }
  Logger.log('已把 ' + n + ' 張照片改回私有');
  return n;
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
