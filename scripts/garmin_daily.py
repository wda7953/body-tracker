# body-tracker/scripts/garmin_daily.py
# 撈 Garmin 昨日（台灣時區）數據 → POST 到 Apps Script addDaily。
# 失敗會以非 0 結束，讓 workflow 走失敗通知步驟。
import os, sys, json, datetime, getpass, urllib.request
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from garmin_login import make_client

def taipei_yesterday():
    tw = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
    return (tw.date() - datetime.timedelta(days=1)).isoformat()

# API 端的設定（非 Garmin 帳密）：有環境變數就用，否則終端機互動輸入
def cred(name, prompt, secret=False):
    v = os.environ.get(name)
    if v: return v
    if not sys.stdin.isatty(): raise SystemExit('缺少環境變數 ' + name)
    return getpass.getpass(prompt) if secret else input(prompt)

def dig(d, *path, default=None):
    for k in path:
        if not isinstance(d, dict): return default
        d = d.get(k)
        if d is None: return default
    return d

def persist_token(g):
    # 把本次登入/刷新後的「最新 token」寫到 TOKEN_OUT 檔，供 workflow 回寫 GitHub Secret。
    # 為什麼一定要做：garminconnect(DI token) 每次刷新會輪替 refresh token 並作廢舊的；
    # 若只把原始 token 放 Secret、刷新後不存回，隔天雲端拿舊的必 401（本系統「不會壞」的關鍵）。
    # 為什麼在「撈完 Garmin 就寫」而非等後端 POST 成功：就算後端一時失敗，token 已被輪替，
    # 不存回就等於丟掉唯一有效的新 token（codex 交叉驗證建議）。
    out = os.environ.get('TOKEN_OUT')
    if not out:
        return
    try:
        with open(out, 'w') as f:
            f.write(g.client.dumps())
        print(f'已輸出刷新後 token → {out}（供 workflow 回寫 Secret）')
    except Exception as e:
        print('輸出刷新 token 失敗（不影響本次資料）：', e, file=sys.stderr)

def main():
    api_url = cred('API_URL', 'Apps Script exec 網址: ')
    token = cred('API_TOKEN', 'API token: ')
    date = os.environ.get('FETCH_DATE') or taipei_yesterday()

    g = make_client()
    stats = g.get_stats(date) or {}
    sleep = g.get_sleep_data(date) or {}
    bb = g.get_body_battery(date, date) or []

    sleep_secs = dig(sleep, 'dailySleepDTO', 'sleepTimeSeconds', default=0) or 0
    bb_high = None
    try:
        levels = (bb[0].get('bodyBatteryValuesArray') or []) if bb else []
        vals = [v[1] for v in levels if len(v) > 1 and v[1] is not None]
        bb_high = max(vals) if vals else None  # 當日身體電量高點（恢復程度）
    except Exception:
        bb_high = None

    # 訓練準備度（0-100，Garmin 綜合 HRV/睡眠/恢復/負荷算出的「今天適合訓練還是休息」）
    # 這些是較新的 Garmin 功能，套件版本或手錶型號不支援就給 None，不讓整個腳本崩
    training_readiness = None
    try:
        tr = g.get_training_readiness(date)
        if isinstance(tr, list) and tr: tr = tr[0]
        if isinstance(tr, dict): training_readiness = tr.get('score')
    except Exception:
        training_readiness = None

    hrv_last_night = None
    hrv_status = None
    try:
        hrv = g.get_hrv_data(date) or {}
        summ = hrv.get('hrvSummary') or {}
        hrv_last_night = summ.get('lastNightAvg')
        hrv_status = summ.get('status')
    except Exception:
        pass

    # Garmin 端已全部撈完，g 內部持有本次刷新後的最新 token → 立刻存回（不等後端 POST）
    persist_token(g)

    payload = {
        'date': date,
        'tdee_total':  stats.get('totalKilocalories'),
        'active_kcal': stats.get('activeKilocalories'),
        'bmr_kcal':    stats.get('bmrKilocalories'),
        'steps':       stats.get('totalSteps'),
        'resting_hr':  stats.get('restingHeartRate'),
        'avg_stress':  stats.get('averageStressLevel'),
        'sleep_score': dig(sleep, 'dailySleepDTO', 'sleepScores', 'overall', 'value'),
        'sleep_hours': round(sleep_secs / 3600, 2),
        'body_battery': bb_high,
        'training_readiness': training_readiness,
        'hrv_last_night': hrv_last_night,
        'hrv_status': hrv_status,
    }

    # 用 requests（帶 certifi 憑證）避免 macOS 上 urllib 的 SSL 憑證錯誤
    import requests
    print('payload:', json.dumps(payload, ensure_ascii=False))
    ok = False
    try:
        r = requests.post(f'{api_url}?action=addDaily&token={token}', json=payload, timeout=30)
        resp = r.json()
        ok = bool(resp.get('ok'))
        print('response:', resp)
    except Exception as e:
        # Apps Script POST 有時因轉址讀不到乾淨回應；改用 GET 直接驗證今天有沒有寫進去
        print('post 回應無法解析，改查後端驗證：', e)
    if not ok:
        chk = requests.get(f'{api_url}?action=getAll&token={token}', timeout=30).json()
        ok = any(str(row.get('date')).startswith(date) for row in chk.get('data', {}).get('daily', []))
    print('verified:', ok)
    if not ok:
        print('backend 未確認寫入', file=sys.stderr); sys.exit(1)

if __name__ == '__main__':
    main()
