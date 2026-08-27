# body-tracker/scripts/garmin_login.py
# 共用 Garmin 登入：支援兩步驟驗證（MFA）＋ token 快取。
# 先試用已存的 token 免登入（避免重複登入被 Garmin 擋 429）；沒有才用帳密登入，
# 登入成功後把 token 存到 GARMINTOKENS（預設 ~/.garminconnect），下次免登入免驗證碼。
import os, sys, getpass
from garminconnect import Garmin

TOKENSTORE = os.path.expanduser(os.environ.get('GARMINTOKENS', '~/.garminconnect'))

def _cred(name, prompt, secret=False):
    v = os.environ.get(name)
    if v:
        return v
    if not sys.stdin.isatty():
        raise SystemExit('缺少環境變數 ' + name + '（CI 環境請用已存的 token）')
    return getpass.getpass(prompt) if secret else input(prompt)

def make_client():
    # 1) 先試用已存 token 免登入
    try:
        g = Garmin()
        g.login(TOKENSTORE)
        print('（使用已存 token 登入，' + TOKENSTORE + '）')
        return g
    except Exception:
        pass
    # 2) 帳密登入（支援兩步驟驗證），成功後存 token
    email = _cred('GARMIN_EMAIL', 'Garmin 信箱: ')
    pw = _cred('GARMIN_PASSWORD', 'Garmin 密碼（輸入時不顯示）: ', secret=True)
    g = Garmin(email, pw)
    g.prompt_mfa = lambda: input('Garmin 兩步驟驗證碼（收到的 6 位數）: ')
    g.login()
    try:
        os.makedirs(TOKENSTORE, exist_ok=True)
        g.garth.dump(TOKENSTORE)
        print('✅ 已儲存登入 token 到 ' + TOKENSTORE + '（下次免登入、免驗證碼）')
    except Exception as e:
        print('（token 儲存失敗，不影響本次：' + str(e) + '）')
    return g
