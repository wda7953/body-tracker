# body-tracker/scripts/cycle_reminder.py
# 每日檢查：預計下次生理期是否「還有 2 天」到；是就用 LINE 推播提醒。
# 一個週期只提醒一次（用後端 setting cycle_last_reminded 記已提醒的預測日，避免同日重跑重複發）。
import os, sys, datetime, statistics
import requests

ADVANCE_DAYS = 2  # 提前幾天提醒


def cred(name):
    v = os.environ.get(name)
    if not v:
        raise SystemExit('缺少環境變數 ' + name)
    return v


def taipei_today():
    return (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).date()


def parse_date(s):
    return datetime.date.fromisoformat(str(s)[:10])


def predict_next(cycle_rows, default_cycle):
    """回傳 (predicted_date, avg_cycle) 或 (None, default_cycle)。邏輯與前端 calc.cycleStats 一致。"""
    starts = sorted({str(r.get('date'))[:10] for r in cycle_rows if r.get('date')})
    if not starts:
        return None, default_cycle
    avg = default_cycle
    if len(starts) >= 2:
        gaps = []
        for a, b in zip(starts, starts[1:]):
            g = (parse_date(b) - parse_date(a)).days
            if g > 0:
                gaps.append(g)
        if gaps:
            avg = round(statistics.mean(gaps))
    last = parse_date(starts[-1])
    return last + datetime.timedelta(days=avg), avg


def line_push(token, user_id, text):
    r = requests.post(
        'https://api.line.me/v2/bot/message/push',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'},
        json={'to': user_id, 'messages': [{'type': 'text', 'text': text}]},
        timeout=30,
    )
    r.raise_for_status()


def main():
    api_url = cred('API_URL')
    token = cred('API_TOKEN')
    line_token = cred('LINE_CHANNEL_ACCESS_TOKEN')
    line_user = cred('LINE_USER_ID')

    data = requests.get(f'{api_url}?action=getAll&token={token}', timeout=30).json().get('data', {})
    cycle_rows = data.get('cycle', [])
    settings = {s.get('key'): s.get('value') for s in data.get('settings', [])}
    default_cycle = int(settings.get('cycle_days') or 30)

    predicted, avg = predict_next(cycle_rows, default_cycle)
    if not predicted:
        print('尚無生理期紀錄，略過')
        return

    days_until = (predicted - taipei_today()).days
    print(f'預計下次 {predicted}（平均週期 {avg} 天），距今 {days_until} 天')

    if days_until != ADVANCE_DAYS:
        print(f'非提醒日（需 = {ADVANCE_DAYS}），略過')
        return

    # 同一個預測日只提醒一次（防同日 workflow 重跑重複發）
    if settings.get('cycle_last_reminded') == predicted.isoformat():
        print('本週期已提醒過，略過')
        return

    msg = f'🩸 生理期提醒：預計 {predicted.month}/{predicted.day}（約 {ADVANCE_DAYS} 天後）就要來了，記得準備。'
    line_push(line_token, line_user, msg)
    # 記錄已提醒，避免重複
    requests.post(f'{api_url}?action=setSetting&token={token}',
                  json={'key': 'cycle_last_reminded', 'value': predicted.isoformat()}, timeout=30)
    print('已發送 LINE 提醒：', msg)


if __name__ == '__main__':
    main()
