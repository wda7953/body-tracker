# body-tracker/scripts/garmin_login.py
# 共用 Garmin 登入：token 快取 + 兩步驟驗證（MFA）。
# g.login(tokenstore)：tokenstore 有效就直接用（免登入免驗證碼），否則用帳密登入，
# 且登入成功後會「自動把 token 存到 tokenstore 路徑」（下次免登入）。
# CI：把 GARMINTOKENS 設成 token JSON 字串（本機用 export_token() 產生），login 會直接讀它。
import os, sys, getpass, time
from garminconnect import Garmin

# GARMINTOKENS 可為「token JSON 字串」(CI) 或「資料夾路徑」；本機預設 ~/.garminconnect
_RAW = os.environ.get('GARMINTOKENS')
TOKENSTORE = _RAW if _RAW else os.path.expanduser('~/.garminconnect')

def _cred(name, prompt, secret=False):
    v = os.environ.get(name)
    if v:
        return v
    if not sys.stdin.isatty():
        return None  # CI 無互動：靠 token，不問帳密
    return getpass.getpass(prompt) if secret else input(prompt)

def make_client():
    email = _cred('GARMIN_EMAIL', 'Garmin 信箱: ')
    pw = _cred('GARMIN_PASSWORD', 'Garmin 密碼（輸入時不顯示）: ', secret=True)
    prompt_mfa = (lambda: input('Garmin 兩步驟驗證碼（6 位數）: ')) if sys.stdin.isatty() else None
    g = Garmin(email, pw, prompt_mfa=prompt_mfa)
    # 有 token 就用；沒有就帳密登入（含 MFA），並自動把 token 存到 TOKENSTORE（若為路徑）
    # Garmin 在排程時段偶發回 401（token 仍有效，手動重跑就過），故加退避重試：
    # 5→15→30s 共 4 次，吸收暫時性錯誤，避免整支腳本因一次性 401 就失敗
    delays = [5, 15, 30]
    for attempt in range(len(delays) + 1):
        try:
            g.login(TOKENSTORE)
            return g
        except Exception as e:
            if attempt >= len(delays):
                raise
            wait = delays[attempt]
            print(f'Garmin 登入失敗（第 {attempt + 1} 次）：{e}；{wait}s 後重試', file=sys.stderr)
            time.sleep(wait)

# 本機執行：登入後印出可貼到 GitHub Secret（GARMINTOKENS）的 token JSON 字串，供雲端排程免登入使用
if __name__ == '__main__':
    g = make_client()
    print('\n===== 複製下面整段（含大括號）貼到 GitHub Secret：GARMINTOKENS =====\n')
    print(g.client.dumps())
