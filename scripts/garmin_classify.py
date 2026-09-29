# body-tracker/scripts/garmin_classify.py
# 把一筆 Garmin 運動紀錄自動歸成 Recovery Clocks 的訓練類型（session）＋強度（intensity）。
# 依據（已用 probe 驗證 Venu 3S 真的有回這些欄位）：
#   activityType.typeKey、trainingEffectLabel、duration(秒)、distance(公尺)、averageHR/maxHR
#   ⚠️ Venu 3S 的 aerobicTrainingEffect/anaerobicTrainingEffect 是 null，不能用；改用 trainingEffectLabel。
# 純函式、零相依，供 garmin_daily.py 呼叫，也可被測試檔直接 import。

RUN_TYPES = {'running', 'treadmill_running', 'trail_running', 'track_running', 'street_running', 'virtual_run'}
BIKE_TYPES = {'cycling', 'indoor_cycling', 'virtual_ride', 'road_biking', 'mountain_biking', 'gravel_cycling'}
CARDIO_TYPES = {'indoor_cardio', 'cardio', 'elliptical', 'hiit', 'fitness_equipment', 'stair_climbing'}
STRENGTH_TYPES = {'strength_training', 'strength'}
WALK_TYPES = {'walking', 'hiking', 'casual_walking'}

# trainingEffectLabel（大寫）→ 意圖
LABEL_EASY = {'RECOVERY', 'BASE', 'AEROBIC_BASE', 'NONE', ''}
LABEL_THRESHOLD = {'TEMPO', 'LACTATE_THRESHOLD', 'LACTATE_THRESHOLD_PLUS'}
LABEL_INTERVAL = {'VO2MAX', 'VO2_MAX', 'ANAEROBIC_CAPACITY'}
LABEL_SPRINT = {'SPEED', 'SPRINT'}


def _intensity(label):
    if label in LABEL_EASY:
        return 'light'
    if label in LABEL_INTERVAL or label in LABEL_SPRINT:
        return 'hard'
    return 'normal'


def classify_activity(a):
    """回傳 (session, intensity)；無法歸類回 None（留白，讓 olan 手動）。"""
    at = a.get('activityType')
    t = (at.get('typeKey') if isinstance(at, dict) else at) or ''
    t = str(t).lower()
    label = str(a.get('trainingEffectLabel') or '').upper()
    dur = a.get('duration') or 0
    dist = a.get('distance') or 0
    inten = _intensity(label)

    if t in STRENGTH_TYPES:
        return ('strength', 'normal')

    if t in RUN_TYPES:
        if label in LABEL_SPRINT:
            return ('sprint', inten)
        if label in LABEL_INTERVAL:
            return ('interval', inten)
        if label in LABEL_THRESHOLD:
            return ('threshold', inten)
        # easy / recovery / base / 無標籤：長距離或長時間 → 長跑
        if dist >= 8000 or dur >= 3600:
            return ('long', 'normal')
        return ('easy', inten)

    if t in BIKE_TYPES or t in CARDIO_TYPES:
        # 低衝擊：即使 label 很操也只算代謝型「有氧/飛輪」，不誤觸發組織/神經肌肉警告
        if label in LABEL_THRESHOLD or label in LABEL_INTERVAL or label in LABEL_SPRINT:
            return ('cardio', inten)
        return ('easy', inten)

    if t in WALK_TYPES:
        return ('easy', 'light')

    return None  # 未知類型（如游泳、瑜伽…）→ 不亂歸，留給手動


if __name__ == '__main__':
    # 快速自測
    import json
    samples = [
        {'activityType': 'running', 'trainingEffectLabel': 'ANAEROBIC_CAPACITY', 'distance': 5601, 'duration': 2267},
        {'activityType': {'typeKey': 'strength_training'}, 'trainingEffectLabel': None, 'duration': 5364},
    ]
    for s in samples:
        print(json.dumps(s, ensure_ascii=False), '->', classify_activity(s))
