import paramiko
import os

HOST = os.environ["SFTP_HOST"]
PORT = int(os.environ.get("SFTP_PORT", 22))
USER = os.environ["SFTP_USER"]
PASS = os.environ["SFTP_PASSWORD"]

LOCAL_FILE = "frames.db"
REMOTE_PATH = "/www/trans-time.ru/api/backend/frames.db"

transport = paramiko.Transport((HOST, PORT))
transport.connect(username=USER, password=PASS)

sftp = paramiko.SFTPClient.from_transport(transport)
sftp.put(LOCAL_FILE, REMOTE_PATH)

sftp.close()
transport.close()

print("frames.db uploaded via SFTP")
