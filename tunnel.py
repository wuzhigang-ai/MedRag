"""SSH reverse tunnel — exposes local MedRAG via 82.156.142.212.
Requires SSH key already uploaded to remote server.
Run: python3 tunnel.py  (Ctrl+C to stop)"""
import subprocess, sys

REMOTE = "root@82.156.142.212"
PORTS = [5173, 8000]

def main():
    args = ["ssh", "-o", "StrictHostKeyChecking=no", "-o", "ServerAliveInterval=30"]
    for p in PORTS:
        args.extend(["-R", f"0.0.0.0:{p}:localhost:{p}"])
    args.extend([REMOTE, "-N"])

    print(f"  http://82.156.142.212:5173 → localhost:5173  [Frontend]")
    print(f"  http://82.156.142.212:8000 → localhost:8000  [Backend]")
    print(f"\n  http://82.156.142.212:5173/#/login  (admin/admin123)")
    print(f"  Ctrl+C to stop\n")

    try:
        subprocess.run(args, check=True)
    except KeyboardInterrupt:
        print("\nTunnel closed.")

if __name__ == "__main__":
    main()
