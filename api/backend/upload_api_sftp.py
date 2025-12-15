import os
import posixpath
import paramiko

HOST = os.environ["SFTP_HOST"]
USER = os.environ["SFTP_USER"]
PASSWORD = os.environ["SFTP_PASSWORD"]
PORT = int(os.environ.get("SFTP_PORT", "22"))

# ВАЖНО: для Reg.ru часто нельзя писать в /www/... по SFTP.
# Грузим в относительный путь. Если не сработает — поменяешь на "api/backend".
REMOTE_DIR = os.environ.get("SFTP_REMOTE_DIR", "trans-time.ru/api/backend")

FILES = [
    "app_flask.py",
    "db.py",
    "models.py",
    "config.py",
    "geojson_import.py",
    "parser_nerudas.py",
    "upload_sftp.py",
]

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(HOST, port=PORT, username=USER, password=PASSWORD)

    sftp = ssh.open_sftp()

    # НЕ создаём папки. Просто проверяем, что папка существует.
    try:
        sftp.stat(REMOTE_DIR)
    except Exception as e:
        raise SystemExit(
            f"[upload_api_sftp] Remote dir not accessible: {REMOTE_DIR}\n"
            f"Try setting SFTP_REMOTE_DIR to 'api/backend' or 'trans-time.ru/api/backend'.\n"
            f"Original error: {e}"
        )

    for fn in FILES:
        local_path = fn
        if not os.path.exists(local_path):
            print(f"[upload_api_sftp] skip missing: {local_path}")
            continue

        remote_path = posixpath.join(REMOTE_DIR, fn)
        print(f"[upload_api_sftp] put {local_path} -> {remote_path}")
        sftp.put(local_path, remote_path)

    sftp.close()
    ssh.close()
    print("[upload_api_sftp] done")

if __name__ == "__main__":
    main()
