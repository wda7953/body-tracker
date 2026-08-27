# body-tracker/scripts/probe_garmin.py
# 一次性：印出 Garmin 昨日原始回傳，確認欄位名（不同版本/帳號可能不同）
import os, json, datetime
from garminconnect import Garmin

def yday():
    tw = datetime.datetime.utcnow() + datetime.timedelta(hours=8)
    return (tw.date() - datetime.timedelta(days=1)).isoformat()

g = Garmin(os.environ['GARMIN_EMAIL'], os.environ['GARMIN_PASSWORD'])
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
