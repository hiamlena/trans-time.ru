import paramiko
import os

HOST = os.environ["SFTP_HOST"]
PORT = int(os.environ.get("SFTP_PORT", 22))
USER = os.environ["SFTP_USER"]
PASS = os.environ["SFTP_PASSWORD"]

LOCAL_FILE = "frames.db"

transport = paramiko.Transport((HOST, PORT))
transport.connect(username=USER, password=PASS)
sftp = paramiko.SFTPClient.from_transport(transport)

def ls(path="."):
    try:
        return sftp.listdir(path)
    except Exception as e:
        return f"ERROR: {e}"

print("SFTP PWD:", sftp.getcwd())
print("SFTP ls('.'): ", ls("."))
print("SFTP ls('..'): ", ls(".."))
print("SFTP ls('www'): ", ls("www"))
print("SFTP ls('public_html'): ", ls("public_html"))
print("SFTP ls('trans-time.ru'): ", ls("trans-time.ru"))

# ПОПРОБУЕМ несколько типичных путей
candidates = [
    "api/backend/frames.db",
    "trans-time.ru/api/backend/frames.db",
    "www/trans-time.ru/api/backend/frames.db",
    "public_html/api/backend/frames.db",
    "public_html/trans-time.ru/api/backend/frames.db",
]

last_err = None
for remote in candidates:
    try:
        print("TRY UPLOAD ->", remote)
        sftp.put(LOCAL_FILE, remote)
        print("OK UPLOADED TO:", remote)
        last_err = None
        break
    except Exception as e:
        print("FAIL:", remote, "=>", e)
        last_err = e

sftp.close()
transport.close()

if last_err:
    raise SystemExit(f"Upload failed for all candidates: {last_err}")
