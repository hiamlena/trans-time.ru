# api/backend/upload_api_sftp.py
import os
import posixpath
import paramiko

HOST = os.environ["SFTP_HOST"]
USER = os.environ["SFTP_USER"]
PASSWORD = os.environ["SFTP_PASSWORD"]
PORT = int(os.environ.get("SFTP_PORT", "22"))

REMOTE_DIR = "/www/trans-time.ru/api/backend"

FILES = [
    "app_flask.py",
    "db.py",
    "models.py",
    "config.py",
    "geojson_import.py",
    "parser_nerudas.py",
    "upload_sftp.py",
    "requirements.txt",
    "__init__.py",
]

def ensure_dir(sftp, path):
    parts = [p for p in path.split("/") if p]
    cur = ""
    for p in parts:
        cur = cur + "/" + p
        try:
            sftp.stat(cur)
        except FileNotFoundError:
            sftp.mkdir(cur)

def main():
    transport = paramiko.Transport((HOST, PORT))
    transport.connect(username=USER, password=PASSWORD)
    sftp = paramiko.SFTPClient.from_transport(transport)

    ensure_dir(sftp, REMOTE_DIR)

    for f in FILES:
        if not os.path.exists(f):
            print(f"[skip] {f} (not found)")
            continue
        remote_path = posixpath.join(REMOTE_DIR, f)
        print(f"[upload] {f} -> {remote_path}")
        sftp.put(f, remote_path)

    sftp.close()
    transport.close()
    print("[ok] api files uploaded")

if __name__ == "__main__":
    main()
