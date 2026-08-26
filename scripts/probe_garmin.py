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
print('=== get_stats ==='); print(json.dumps(g.get_stats(d), ensure_ascii=False, indent=2)[:4000])
print('=== get_sleep_data ==='); print(json.dumps(g.get_sleep_data(d), ensure_ascii=False, indent=2)[:2000])
print('=== get_body_battery ==='); print(json.dumps(g.get_body_battery(d, d), ensure_ascii=False, indent=2)[:2000])
