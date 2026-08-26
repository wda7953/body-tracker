# body-tracker/scripts/garmin_daily.py
# 撈 Garmin 昨日（台灣時區）數據 → POST 到 Apps Script addDaily。
# 失敗會以非 0 結束，讓 workflow 走失敗通知步驟。
import os, sys, json, datetime, urllib.request
from garminconnect import Garmin

def taipei_yesterday():
    tw = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    return (tw.date() - datetime.timedelta(days=1)).isoformat()

def dig(d, *path, default=None):
    for k in path:
        if not isinstance(d, dict): return default
        d = d.get(k)
        if d is None: return default
    return d

def main():
    email = os.environ['GARMIN_EMAIL']; pw = os.environ['GARMIN_PASSWORD']
    api_url = os.environ['API_URL']; token = os.environ['API_TOKEN']
    date = os.environ.get('FETCH_DATE') or taipei_yesterday()

    g = Garmin(email, pw); g.login()
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
    }

    url = f'{api_url}?action=addDaily&token={token}'
    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'),
                                 headers={'Content-Type': 'application/json'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        resp = json.loads(r.read().decode('utf-8'))
    print('payload:', json.dumps(payload, ensure_ascii=False))
    print('response:', resp)
    if not resp.get('ok'):
        print('backend rejected', file=sys.stderr); sys.exit(1)

if __name__ == '__main__':
    main()
