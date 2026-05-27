#!/usr/bin/env python3
"""
远程MinerU解析工具 — SSH到Linux服务器执行PDF解析，下载结果到本地

Usage:
    python scripts/remote_parse.py --pdf ./path/to/doc.pdf
    python scripts/remote_parse.py --batch ./pdfs/           # 批量解析
    python scripts/remote_parse.py --download-only            # 仅下载最新结果
"""

import os
import sys
import json
import time
import argparse
import tempfile
from pathlib import Path
from typing import Optional

import paramiko

REMOTE_HOST = "82.156.142.212"
REMOTE_PORT = 22
REMOTE_USER = "root"
REMOTE_PASSWORD = "16693039508@m"
REMOTE_PDF_DIR = "/root/pdfs"
REMOTE_OUTPUT_DIR = "/root/output"
REMOTE_MINERU_BIN = "mineru"


class RemoteMinerUParser:
    """远程MinerU解析客户端"""

    def __init__(self):
        self.ssh = paramiko.SSHClient()
        self.ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
        self.sftp = None

    def connect(self):
        print(f"Connecting to {REMOTE_HOST}...")
        self.ssh.connect(
            REMOTE_HOST, port=REMOTE_PORT,
            username=REMOTE_USER, password=REMOTE_PASSWORD,
            timeout=30,
        )
        self.sftp = self.ssh.open_sftp()
        print("Connected.")

    def close(self):
        if self.sftp:
            self.sftp.close()
        if self.ssh:
            self.ssh.close()

    def exec(self, cmd: str) -> tuple:
        """Execute command on remote server"""
        stdin, stdout, stderr = self.ssh.exec_command(cmd, timeout=600)
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        exit_code = stdout.channel.recv_exit_status()
        return exit_code, out, err

    def ensure_dirs(self):
        """Ensure remote directories exist"""
        self.exec(f"mkdir -p {REMOTE_PDF_DIR} {REMOTE_OUTPUT_DIR}")

    def upload_pdf(self, local_path: str) -> str:
        """Upload a PDF to remote server, return remote path"""
        local_path = Path(local_path)
        remote_path = f"{REMOTE_PDF_DIR}/{local_path.name}"
        print(f"Uploading: {local_path.name} ({local_path.stat().st_size / 1024:.0f} KB)...")
        self.sftp.put(str(local_path), remote_path)
        print(f"  -> {remote_path}")
        return remote_path

    def parse_pdf(self, remote_pdf_path: str) -> Optional[str]:
        """Run MinerU on remote server"""
        pdf_name = Path(remote_pdf_path).stem
        output_dir = f"{REMOTE_OUTPUT_DIR}/{pdf_name}"

        cmd = (
            f"cd /root && "
            f"source /root/mineru_env/bin/activate 2>/dev/null; "
            f"export HF_ENDPOINT=https://hf-mirror.com; "
            f"{REMOTE_MINERU_BIN} -p '{remote_pdf_path}' -o '{output_dir}' "
            f"-b pipeline -l ch --formula True --table True"
        )

        print(f"Running MinerU on remote: {pdf_name}")
        print(f"  CMD: {cmd[:150]}...")
        exit_code, out, err = self.exec(cmd)

        if exit_code != 0:
            print(f"  ERROR (exit={exit_code}): {err[:500]}")
            return None

        print(f"  OK: {out[-200:] if out else 'no stdout'}")

        # Find content_list.json in output
        find_cmd = f"find {output_dir} -name '*_content_list.json' -type f"
        _, find_out, _ = self.exec(find_cmd)
        content_list_files = [f.strip() for f in find_out.split("\n") if f.strip()]

        if not content_list_files:
            print(f"  WARNING: No content_list.json found in {output_dir}")
            return None

        return content_list_files[0]

    def download_results(self, remote_dir: str, local_dir: str = "./output/remote_test"):
        """Download all parsing results and images from remote"""
        os.makedirs(local_dir, exist_ok=True)

        # List all content_list.json files
        _, find_out, _ = self.exec(f"find {REMOTE_OUTPUT_DIR} -name '*_content_list.json' -o -name '*.md' | head -50")
        files = [f.strip() for f in find_out.split("\n") if f.strip()]

        if not files:
            print("No results found on remote server.")
            return []

        downloaded = []
        for remote_path in files:
            fname = Path(remote_path).name
            parent = Path(remote_path).parent.name
            local_name = f"{parent}_{fname}" if parent != "output" else fname
            local_path = os.path.join(local_dir, local_name)

            print(f"Downloading: {fname} ({self.sftp.stat(remote_path).st_size / 1024:.0f} KB)")
            self.sftp.get(remote_path, local_path)
            downloaded.append(local_path)

        # Download images from remote MinerU output directories
        local_images = os.path.join(local_dir, "images")
        os.makedirs(local_images, exist_ok=True)
        _, img_find, _ = self.exec(
            f"find {REMOTE_OUTPUT_DIR} -type f \\( -name '*.png' -o -name '*.jpg' -o -name '*.jpeg' \\) | head -200"
        )
        img_files = [f.strip() for f in img_find.split("\n") if f.strip()]
        img_downloaded = 0
        for remote_img in img_files:
            try:
                img_name = Path(remote_img).name
                local_img = os.path.join(local_images, img_name)
                if not os.path.exists(local_img):
                    self.sftp.get(remote_img, local_img)
                    img_downloaded += 1
            except Exception as e:
                print(f"  (skip image {Path(remote_img).name}: {e})")
        if img_downloaded:
            print(f"Downloaded {img_downloaded} images to {local_images}")

        print(f"Downloaded {len(downloaded)} files + {img_downloaded} images to {local_dir}")
        return downloaded

    def list_remote_results(self) -> list:
        """List available results on remote"""
        _, out, _ = self.exec(f"find {REMOTE_OUTPUT_DIR} -name '*_content_list.json' -type f")
        files = [f.strip() for f in out.split("\n") if f.strip()]
        for f in files:
            try:
                size = self.sftp.stat(f).st_size
                print(f"  {f} ({size/1024:.0f} KB)")
            except Exception:
                print(f"  {f}")
        return files


def main():
    parser = argparse.ArgumentParser(description="Remote MinerU PDF Parser")
    parser.add_argument("--pdf", help="Single PDF file to parse")
    parser.add_argument("--batch", help="Directory of PDFs to batch parse")
    parser.add_argument("--download-only", action="store_true", help="Only download latest results")
    parser.add_argument("--list", action="store_true", help="List remote results")
    parser.add_argument("--output", default="./output/remote_test", help="Local output directory")
    args = parser.parse_args()

    remote = RemoteMinerUParser()
    try:
        remote.connect()
        remote.ensure_dirs()

        if args.list:
            remote.list_remote_results()
            return

        if args.download_only:
            remote.download_results(REMOTE_OUTPUT_DIR, args.output)
            return

        if args.pdf:
            remote_path = remote.upload_pdf(args.pdf)
            result = remote.parse_pdf(remote_path)
            if result:
                remote.download_results(REMOTE_OUTPUT_DIR, args.output)
            return

        if args.batch:
            pdf_files = list(Path(args.batch).glob("*.pdf"))
            print(f"Batch processing {len(pdf_files)} PDFs...")
            for pdf_file in pdf_files:
                try:
                    remote_path = remote.upload_pdf(str(pdf_file))
                    result = remote.parse_pdf(remote_path)
                    if result:
                        print(f"  SUCCESS: {pdf_file.name}")
                    else:
                        print(f"  FAILED: {pdf_file.name}")
                except Exception as e:
                    print(f"  ERROR ({pdf_file.name}): {e}")
                time.sleep(2)  # Pace between files

            remote.download_results(REMOTE_OUTPUT_DIR, args.output)
            return

        parser.print_help()

    finally:
        remote.close()


if __name__ == "__main__":
    main()
