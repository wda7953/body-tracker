# body-tracker/scripts/probe_garmin.py
# 一次性：印出 Garmin 昨日原始回傳，確認欄位名（不同版本/帳號可能不同）
import os, sys, json, datetime, getpass
from garminconnect import Garmin

def yday():
    tw = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    return (tw.date() - datetime.timedelta(days=1)).isoformat()

# 有環境變數就用（CI 用）；沒有就在終端機互動輸入（本機用，密碼隱藏）
def cred(name, prompt, secret=False):
    v = os.environ.get(name)
    if v: return v
    if not sys.stdin.isatty(): raise SystemExit('缺少環境變數 ' + name)
    return getpass.getpass(prompt) if secret else input(prompt)

email = cred('GARMIN_EMAIL', 'Garmin 信箱: ')
pw = cred('GARMIN_PASSWORD', 'Garmin 密碼（輸入時不顯示）: ', secret=True)
g = Garmin(email, pw)
g.login()
d = os.environ.get('FETCH_DATE') or yday()
def show(name, fn):
    print('=== ' + name + ' ===')
    try:
        print(json.dumps(fn(), ensure_ascii=False, indent=2)[:2500])
    except Exception as e:
        print('（此方法不支援或出錯：' + str(e) + '）')

show('get_stats', lambda: g.get_stats(d))
show('get_sleep_data', lambda: g.get_sleep_data(d))
show('get_body_battery', lambda: g.get_body_battery(d, d))
# 較新功能：訓練準備度、HRV（版本/手錶不支援會顯示錯誤，屬正常）
show('get_training_readiness', lambda: g.get_training_readiness(d))
show('get_hrv_data', lambda: g.get_hrv_data(d))
