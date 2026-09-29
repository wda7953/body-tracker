# body-tracker/scripts/test_classify.py
# garmin_classify 的測試（用 olan Venu 3S 實際 probe 出來的樣本）。跑法：python3 scripts/test_classify.py
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from garmin_classify import classify_activity

cases = [
    # (描述, activity, 期望)
    ('室內自行車 RECOVERY → easy/light',
     {'activityType': 'indoor_cycling', 'trainingEffectLabel': 'RECOVERY', 'duration': 1820, 'distance': 0, 'averageHR': 103}, ('easy', 'light')),
    ('室內有氧 SPEED → cardio/hard（低衝擊，不歸 sprint）',
     {'activityType': 'indoor_cardio', 'trainingEffectLabel': 'SPEED', 'duration': 2288, 'distance': 0, 'averageHR': 128}, ('cardio', 'hard')),
    ('跑步 ANAEROBIC_CAPACITY 5.6km → interval/hard',
     {'activityType': 'running', 'trainingEffectLabel': 'ANAEROBIC_CAPACITY', 'duration': 2267, 'distance': 5601, 'averageHR': 158}, ('interval', 'hard')),
    ('跑步 RECOVERY 793m 短 → easy/light',
     {'activityType': 'running', 'trainingEffectLabel': 'RECOVERY', 'duration': 280, 'distance': 793, 'averageHR': 148}, ('easy', 'light')),
    ('肌力訓練（typeKey dict）→ strength/normal',
     {'activityType': {'typeKey': 'strength_training'}, 'trainingEffectLabel': None, 'duration': 5364, 'distance': 0}, ('strength', 'normal')),
    ('跑步 RECOVERY 但 10km/長 → long',
     {'activityType': 'running', 'trainingEffectLabel': 'BASE', 'duration': 3900, 'distance': 10000}, ('long', 'normal')),
    ('跑步 TEMPO → threshold',
     {'activityType': 'running', 'trainingEffectLabel': 'TEMPO', 'duration': 1800, 'distance': 5000}, ('threshold', 'normal')),
    ('跑步 SPEED → sprint/hard',
     {'activityType': 'running', 'trainingEffectLabel': 'SPEED', 'duration': 900, 'distance': 2000}, ('sprint', 'hard')),
    ('游泳（未知）→ None（留白給手動）',
     {'activityType': 'lap_swimming', 'trainingEffectLabel': 'TEMPO', 'duration': 1800}, None),
]

fail = 0
for desc, act, expect in cases:
    got = classify_activity(act)
    ok = got == expect
    print(('✔' if ok else '✗'), desc, '→', got, '' if ok else f'(期望 {expect})')
    if not ok:
        fail += 1

print(f'\n{len(cases) - fail}/{len(cases)} 通過')
sys.exit(1 if fail else 0)
