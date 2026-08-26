# Body tracker

Garmin 自動匯入 + 手輸體重的**減脂追蹤 PWA**。

- **自動**：每天早上 GitHub Actions 用你的 Garmin 帳號撈昨天的總消耗(TDEE)、活動/靜息消耗、步數、靜息心率、睡眠分數、壓力、身體電量，寫進 Google Sheet。
- **手輸**：體重（必填）、腰圍、進度照片。
- **算給你看**：體重 7 日均線、用體重趨勢反推的實際熱量缺口、推估攝食、達標預估、每日一句教練建議（結合睡眠/壓力/電量）。

架構：靜態 PWA（GitHub Pages）＋ Google Apps Script 後端寫 Google Sheet，token 驗證。照片存 Google Drive。計算核心是零相依 JS，`node --test` 覆蓋（21 tests）。

---

## 部署步驟（照順序做一次即可）

### 步驟 1：建 Google Sheet 與後端

1. 到 https://sheets.google.com 建一個新試算表，命名「身體追蹤」。分頁不用手動建，後端第一次呼叫會自動建 `daily`／`body`／`settings`。
2. 在試算表上方選單：**擴充功能 → Apps Script**。
3. 把本專案的 `apps-script.gs` 全部內容貼進去（覆蓋原本的空白 `Code.gs`）。
4. 在最上面把 `const API_TOKEN = 'CHANGE_ME_body_token';` 的 `CHANGE_ME_body_token` 改成你自己的密鑰（隨便一串英數字，例如 `body_9f3k2m8x`），**記下來**，後面前端和 GitHub 都要用同一組。
5. 右上角 **部署 → 新增部署作業**：
   - 類型選「**網頁應用程式**」
   - 「執行身分」選：**我**
   - 「誰可以存取」選：**任何人**
   - 按「部署」
6. 第一次會跳出授權視窗，一路按「允許」（它要權限存取你的試算表和 Drive）。
7. 部署完成會給一段「**網頁應用程式 URL**」（`https://script.google.com/macros/s/AKfy.../exec`），**複製記下來**。
8. 驗證後端有活著：把下面網址的 `XXX` 和 `你的密鑰` 換掉，貼到瀏覽器：
   `https://script.google.com/macros/s/XXX/exec?action=getAll&token=你的密鑰`
   看到 `{"ok":true,"data":{"daily":[],"body":[],"settings":[]}}` 就成功。

### 步驟 2：填入前端設定

打開本專案 `js/api.js`，把兩個佔位字串換成實際值：
- `API_URL` → 步驟 1-7 那段網頁應用程式 URL
- `API_TOKEN` → 步驟 1-4 你設的密鑰（要跟後端一模一樣）

### 步驟 3：推上 GitHub 並開 Pages

1. 在 GitHub 建一個新 repo，例如 `body-tracker`。
2. 把本資料夾推上去（它本身就是獨立 git repo）：
   ```bash
   git remote add origin https://github.com/你的帳號/body-tracker.git
   git push -u origin main
   ```
3. GitHub repo 頁 → **Settings → Pages** → Source 選 `main` 分支、資料夾選 `/ (root)` → Save。
4. 等一兩分鐘，會給你網址：`https://你的帳號.github.io/body-tracker/`

### 步驟 4：設定 GitHub Secrets（給 Garmin 排程用）

GitHub repo 頁 → **Settings → Secrets and variables → Actions → New repository secret**，新增這四個：

| 名稱 | 值 |
|---|---|
| `GARMIN_EMAIL` | 你的 Garmin Connect 登入信箱 |
| `GARMIN_PASSWORD` | 你的 Garmin Connect 密碼 |
| `BODY_API_URL` | 步驟 1-7 的網頁應用程式 URL |
| `BODY_API_TOKEN` | 你的密鑰（同後端） |

### 步驟 5：設定小目標體重

把下面的 `XXX`／密鑰換掉，在終端機執行一次（目標 52kg）：
```bash
curl -s -X POST "https://script.google.com/macros/s/XXX/exec?action=setSetting&token=你的密鑰" -d '{"key":"target_weight","value":52}'
```

### 步驟 6：手機加到主畫面

用 iPhone **Safari** 開 `https://你的帳號.github.io/body-tracker/` → 底部分享鈕 → **加入主畫面**。之後就像 App 一樣用。

---

## 日常怎麼用

- **每天早上**：Garmin 數據自動進來（排程 UTC 22:00＝台灣 06:00）。
- **量完體重**：打開 App →「記錄」→ 填體重（腰圍/照片選填）→ 儲存。
- **看進度**：「儀表板」看趨勢、缺口、達標預估、今日建議；「照片」看首末對比。

---

## 常見操作

### 手動補跑 Garmin 撈取
GitHub repo → **Actions → garmin-daily → Run workflow**（`workflow_dispatch`）。撈特定某天：暫時在 workflow 加 `FETCH_DATE` 環境變數，或本機跑（見下）。

### 換小目標體重
達標後重設，把步驟 5 的數字換掉再跑一次即可。

### 本機測試 Garmin 撈取（第一次部署建議先跑）
```bash
cd scripts
python3 -m pip install -r requirements.txt
# 先探測欄位，確認你的帳號回傳的鍵名跟程式一致：
GARMIN_EMAIL='信箱' GARMIN_PASSWORD='密碼' python3 probe_garmin.py
# 實際撈昨天並寫入：
GARMIN_EMAIL='信箱' GARMIN_PASSWORD='密碼' \
API_URL='https://script.google.com/macros/s/XXX/exec' API_TOKEN='你的密鑰' \
python3 garmin_daily.py
```

---

## 疑難排解

### Garmin 登入失敗 / 兩步驟驗證（MFA）
- 若你的 Garmin 帳號開了兩步驟驗證，`login()` 在 GitHub Actions（無互動環境）可能過不了。
- 解法：先在**本機**互動登入一次（跑上面的 `probe_garmin.py`，照提示輸入驗證碼），`garminconnect` 會把 token 快取到本機 `~/.garminconnect`，之後同機器就不用再輸入。
- 若 Actions 仍卡登入，改用 `garth` 的 token 流程：本機登入後把產生的 token 目錄內容存成 GitHub Secret，讓 workflow 還原後再用（這條之後需要時再接）。

### 非官方套件偶爾被 Garmin 擋
- `python-garminconnect` 是非官方套件，Garmin 偶爾會擋登入。撈失敗時 workflow 會走「失敗通知」步驟（目前只 echo，之後接 LINE 見下）。手動補跑通常隔一陣子就會恢復。

### 照片顯示不出來
- 照片存在你 Google Drive 的 `body-tracker-photos` 資料夾，且設為「知道連結的人可看」。若圖破圖，確認該資料夾/檔案分享權限沒被改掉。

---

## 待接（部署後的後續，非上線必需）
- **失敗通知接 LINE**：workflow 目前失敗只 echo，之後改呼叫你現有的 `send_line_reminder.py`（憑證走 macOS Keychain / GitHub Secret）。
- **同步排程總覽**：在 `weekly-schedule-summary.yml` 固定文字加「每天 06:00 Garmin 身體追蹤撈取」，並更新 auto-memory `project-github-actions`。
