"""SSH reverse tunnel — exposes local MedRAG to 82.156.142.212.
Run: python3 tunnel.py
Keeps running until Ctrl+C."""
import paramiko, time, signal, sys

REMOTE = "82.156.142.212"
USER = "root"
PASS = "16693039508@m"
PORTS = {5173: "Frontend (Admin)", 8000: "Backend (API)"}

def main():
    ssh = paramiko.SSHClient()
    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(REMOTE, username=USER, password=PASS, timeout=10)

    transport = ssh.get_transport()
    for port in PORTS:
        transport.request_port_forward('0.0.0.0', port, ('127.0.0.1', port))
        print(f"  http://{REMOTE}:{port} → localhost:{port}  [{PORTS[port]}]")

    def cleanup(sig, frame):
        for port in PORTS:
            try: transport.cancel_port_forward('0.0.0.0', port)
            except: pass
        ssh.close()
        sys.exit(0)
    signal.signal(signal.SIGINT, cleanup)
    signal.signal(signal.SIGTERM, cleanup)

    print(f"\n✅ Tunnel active. Access from anywhere:")
    print(f"   http://{REMOTE}:5173/#/login  (admin/admin123)")
    print(f"\nPress Ctrl+C to stop.\n")

    while True:
        time.sleep(60)

if __name__ == "__main__":
    main()
