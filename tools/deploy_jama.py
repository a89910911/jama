#!/usr/bin/env python3
"""Build a release archive and deploy Jama to the configured Linux server."""

from __future__ import annotations

import argparse
import base64
import datetime as dt
import hashlib
import os
import pathlib
import re
import shlex
import subprocess
import sys
import tarfile
import tempfile

import paramiko


DEFAULT_HOST_KEY = "SHA256:a+iFhcXtlPyjOwgFyrMu5OP2JWihLJGyEgFF5QAq1Uo"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


class PinnedHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    def __init__(self, expected_fingerprint: str):
        self.expected_fingerprint = expected_fingerprint

    def missing_host_key(self, client, hostname, key):
        actual = ssh_fingerprint(key)
        if actual != self.expected_fingerprint:
            raise paramiko.SSHException(
                f"SSH host key mismatch for {hostname}: expected "
                f"{self.expected_fingerprint}, received {actual}"
            )
        client.get_host_keys().add(hostname, key.get_name(), key)


def ssh_fingerprint(key) -> str:
    digest = hashlib.sha256(key.asbytes()).digest()
    return "SHA256:" + base64.b64encode(digest).decode("ascii").rstrip("=")


def parse_args():
    parser = argparse.ArgumentParser(description="Deploy Jama frontend and backend")
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--host", default="101.35.214.179")
    parser.add_argument("--port", type=int, default=22)
    parser.add_argument("--user", default="root")
    parser.add_argument(
        "--remote-root",
        default="/www/wwwroot/jama.artisoul.top",
    )
    parser.add_argument("--service", default="jama.service")
    parser.add_argument("--domain", default="jama.artisoul.top")
    parser.add_argument("--identity-file")
    parser.add_argument("--host-key", default=DEFAULT_HOST_KEY)
    parser.add_argument("--keep-backups", type=int, default=5)
    return parser.parse_args()


def checked_workspace(value: str) -> pathlib.Path:
    workspace = pathlib.Path(value).resolve()
    required = [
        workspace / "backend-node" / "package.json",
        workspace / "frontweb" / "dist" / "index.html",
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise RuntimeError("Required deployment files are missing: " + ", ".join(missing))
    return workspace


def git_revision(workspace: pathlib.Path) -> str:
    try:
        revision = subprocess.check_output(
            ["git", "rev-parse", "--short=10", "HEAD"],
            cwd=workspace,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
        status = subprocess.check_output(
            ["git", "status", "--porcelain"],
            cwd=workspace,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        dirty = bool(status.strip())
        return revision + ("-dirty" if dirty else "")
    except (OSError, subprocess.CalledProcessError):
        return "working-tree"


def backend_tar_filter(info: tarfile.TarInfo):
    normalized = info.name.replace("\\", "/")
    name = pathlib.PurePosixPath(normalized).name.lower()
    if name.endswith(".log"):
        return None
    if normalized.lower().endswith("/tools/ffmpeg/ffmpeg.exe"):
        return None
    if "/node_modules/" in normalized or normalized.endswith("/node_modules"):
        return None
    if "/data/" in normalized or normalized.endswith("/data"):
        return None
    if name.startswith(".env.mysql.") and not name.endswith(".example"):
        return None
    return info


def build_archives(workspace: pathlib.Path, output_dir: pathlib.Path):
    backend_root = workspace / "backend-node"
    backend_archive = output_dir / "backend.tar.gz"
    frontend_archive = output_dir / "frontend.tar.gz"
    backend_items = [
        "src",
        "migrations",
        "scripts",
        "tools",
        "package.json",
        "package-lock.json",
        ".npmrc",
        ".gitignore",
        ".env.mysql.test.example",
        ".env.mysql.prod.example",
        "README.md",
        "MYSQL.md",
    ]
    with tarfile.open(backend_archive, "w:gz", compresslevel=6) as archive:
        for item in backend_items:
            source = backend_root / item
            if source.exists():
                archive.add(
                    source,
                    arcname=f"backend-node/{item}",
                    recursive=True,
                    filter=backend_tar_filter,
                )
    with tarfile.open(frontend_archive, "w:gz", compresslevel=6) as archive:
        archive.add(
            workspace / "frontweb" / "dist",
            arcname="frontweb-dist",
            recursive=True,
        )
    return backend_archive, frontend_archive


def validate_remote_inputs(args):
    if not re.fullmatch(r"[A-Za-z0-9_.@-]+", args.service):
        raise RuntimeError("Invalid systemd service name")
    if not re.fullmatch(r"[A-Za-z0-9.-]+", args.domain):
        raise RuntimeError("Invalid domain")
    if not args.remote_root.startswith("/") or args.remote_root in {"/", "/www", "/www/wwwroot"}:
        raise RuntimeError("remote-root must be the exact site directory")
    if not 1 <= args.keep_backups <= 50:
        raise RuntimeError("keep-backups must be between 1 and 50")


def connect(args):
    password = os.environ.get("JAMA_DEPLOY_SSH_PASSWORD")
    if not args.identity_file and not password:
        raise RuntimeError(
            "Set JAMA_DEPLOY_SSH_PASSWORD or provide --identity-file"
        )
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    client.set_missing_host_key_policy(PinnedHostKeyPolicy(args.host_key))
    connect_args = {
        "hostname": args.host,
        "port": args.port,
        "username": args.user,
        "timeout": 20,
        "banner_timeout": 20,
        "auth_timeout": 20,
    }
    if args.identity_file:
        connect_args["key_filename"] = str(pathlib.Path(args.identity_file).expanduser())
        connect_args["look_for_keys"] = True
        connect_args["allow_agent"] = True
    else:
        connect_args["password"] = password
        connect_args["look_for_keys"] = False
        connect_args["allow_agent"] = False
    client.connect(**connect_args)
    return client


def run_remote(client, command: str, check=True):
    stdin, stdout, stderr = client.exec_command(command)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    if out:
        print(out, end="" if out.endswith("\n") else "\n")
    if err:
        print(err, file=sys.stderr, end="" if err.endswith("\n") else "\n")
    if check and code:
        raise RuntimeError(f"Remote command failed with exit code {code}")
    return code


def upload(sftp, local_path: pathlib.Path, remote_path: str):
    size = local_path.stat().st_size
    print(f"Uploading {local_path.name} ({size / 1024 / 1024:.1f} MiB)...")
    temporary = remote_path + ".part"
    last_percent = -10

    def progress(transferred, total):
        nonlocal last_percent
        percent = int((transferred * 100) / max(total, 1))
        if percent >= last_percent + 10 or percent == 100:
            print(f"  {percent}%")
            last_percent = percent

    sftp.put(str(local_path), temporary, callback=progress)
    sftp.chmod(temporary, 0o600)
    sftp.posix_rename(temporary, remote_path)


REMOTE_DEPLOY_SCRIPT = r"""#!/usr/bin/env bash
set -euo pipefail

SITE_ROOT="$1"
RELEASE_ID="$2"
SERVICE="$3"
DOMAIN="$4"
KEEP_BACKUPS="$5"

DEPLOY_ROOT="$SITE_ROOT/.deploy"
INCOMING="$DEPLOY_ROOT/incoming/$RELEASE_ID"
STAGE_BACKEND="$INCOMING/backend-node"
STAGE_FRONTEND="$INCOMING/frontweb-dist"
CURRENT_BACKEND="$SITE_ROOT/backend-node"
CURRENT_FRONTEND="$SITE_ROOT/frontweb/dist"
SHARED_ROOT="$DEPLOY_ROOT/shared"
SHARED_DATA="$SHARED_ROOT/data"
BACKUP_ROOT="$DEPLOY_ROOT/backups"
BACKUP="$BACKUP_ROOT/$RELEASE_ID"
FAILED_ROOT="$DEPLOY_ROOT/failed/$RELEASE_ID"
LOCK_DIR="$DEPLOY_ROOT/deploy.lock"
switch_started=0

mkdir -p "$DEPLOY_ROOT" "$BACKUP_ROOT" "$SHARED_ROOT"
chmod 755 "$DEPLOY_ROOT" "$BACKUP_ROOT" "$SHARED_ROOT"
if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  echo "Another deployment is already running: $LOCK_DIR" >&2
  exit 1
fi

cleanup_lock() {
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

rollback() {
  status=$?
  trap - ERR INT TERM
  echo "Deployment failed; starting rollback..." >&2
  if [ "$switch_started" = "1" ]; then
    systemctl stop "$SERVICE" 2>/dev/null || true
    mkdir -p "$FAILED_ROOT" "$SITE_ROOT/frontweb"
    if [ -d "$BACKUP/backend-node" ]; then
      if [ -e "$CURRENT_BACKEND" ] || [ -L "$CURRENT_BACKEND" ]; then
        mv "$CURRENT_BACKEND" "$FAILED_ROOT/backend-node" 2>/dev/null || true
      fi
      mv "$BACKUP/backend-node" "$CURRENT_BACKEND"
    fi
    if [ -d "$BACKUP/frontweb/dist" ]; then
      if [ -e "$CURRENT_FRONTEND" ] || [ -L "$CURRENT_FRONTEND" ]; then
        mv "$CURRENT_FRONTEND" "$FAILED_ROOT/frontweb-dist" 2>/dev/null || true
      fi
      mkdir -p "$SITE_ROOT/frontweb"
      mv "$BACKUP/frontweb/dist" "$CURRENT_FRONTEND"
    fi
    systemctl start "$SERVICE" 2>/dev/null || true
  fi
  cleanup_lock
  journalctl -u "$SERVICE" --no-pager -n 50 >&2 || true
  exit "$status"
}
trap rollback ERR INT TERM

echo "[1/6] Extracting release $RELEASE_ID"
mkdir -p "$INCOMING"
tar --no-same-owner -xzf "$INCOMING/backend.tar.gz" -C "$INCOMING"
tar --no-same-owner -xzf "$INCOMING/frontend.tar.gz" -C "$INCOMING"
test -f "$STAGE_BACKEND/package.json"
test -f "$STAGE_BACKEND/package-lock.json"
test -f "$STAGE_FRONTEND/index.html"

echo "[2/6] Preserving production configuration"
if [ -d "$CURRENT_BACKEND/configs" ]; then
  rm -rf -- "$STAGE_BACKEND/configs"
  cp -a "$CURRENT_BACKEND/configs" "$STAGE_BACKEND/configs"
fi
for runtime_file in .env.mysql.prod .env.mysql.test; do
  if [ -f "$CURRENT_BACKEND/$runtime_file" ]; then
    cp -a "$CURRENT_BACKEND/$runtime_file" "$STAGE_BACKEND/$runtime_file"
    chmod 600 "$STAGE_BACKEND/$runtime_file"
  fi
done

echo "[3/6] Installing backend production dependencies"
(
  cd "$STAGE_BACKEND"
  CI=1 npm_config_progress=false npm ci --omit=dev --no-audit --no-fund
  node --check src/server.js
)

echo "[4/6] Switching frontend and backend"
switch_started=1
systemctl stop "$SERVICE"

if [ -d "$CURRENT_BACKEND/data" ] && [ ! -L "$CURRENT_BACKEND/data" ]; then
  if [ -e "$SHARED_DATA" ] || [ -L "$SHARED_DATA" ]; then
    echo "Both current data and shared data exist; refusing to guess which is authoritative" >&2
    exit 1
  fi
  mv "$CURRENT_BACKEND/data" "$SHARED_DATA"
  ln -s "$SHARED_DATA" "$CURRENT_BACKEND/data"
fi

if [ ! -d "$SHARED_DATA" ]; then
  echo "Shared data directory is missing: $SHARED_DATA" >&2
  exit 1
fi
if [ "$(readlink -f "$CURRENT_BACKEND/data")" != "$(readlink -f "$SHARED_DATA")" ]; then
  echo "Current data path does not resolve to shared data" >&2
  exit 1
fi

ln -s "$SHARED_DATA" "$STAGE_BACKEND/data"
mkdir -p "$BACKUP/frontweb"
mv "$CURRENT_BACKEND" "$BACKUP/backend-node"
mv "$CURRENT_FRONTEND" "$BACKUP/frontweb/dist"
mv "$STAGE_BACKEND" "$CURRENT_BACKEND"
mv "$STAGE_FRONTEND" "$CURRENT_FRONTEND"
chown -R jama:jama "$CURRENT_BACKEND" "$CURRENT_FRONTEND"
chown -h jama:jama "$CURRENT_BACKEND/data"

echo "[5/6] Starting $SERVICE and checking health"
systemctl start "$SERVICE"
healthy=0
for _attempt in $(seq 1 30); do
  if curl -fsS --max-time 3 http://127.0.0.1:5679/health >/dev/null; then
    healthy=1
    break
  fi
  sleep 1
done
if [ "$healthy" != "1" ]; then
  echo "Backend health check failed" >&2
  exit 1
fi
curl -fsS --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" \
  "https://$DOMAIN/health" >/dev/null
curl -fsS --max-time 10 --resolve "$DOMAIN:443:127.0.0.1" \
  "https://$DOMAIN/" >/dev/null

echo "[6/6] Finalizing deployment"
systemctl is-active --quiet "$SERVICE"
rm -rf -- "$INCOMING"

mapfile -t old_backups < <(
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -nr | awk '{print $2}'
)
if [ "${#old_backups[@]}" -gt "$KEEP_BACKUPS" ]; then
  for old_backup in "${old_backups[@]:$KEEP_BACKUPS}"; do
    resolved_old="$(readlink -f "$old_backup")"
    resolved_root="$(readlink -f "$BACKUP_ROOT")"
    case "$resolved_old" in
      "$resolved_root"/*) rm -rf -- "$resolved_old" ;;
      *) echo "Refusing to remove unexpected backup path: $resolved_old" >&2; exit 1 ;;
    esac
  done
fi

switch_started=0
trap - ERR INT TERM
cleanup_lock
echo "DEPLOYMENT_SUCCESS release=$RELEASE_ID backup=$BACKUP"
"""


def run_deployment(client, args, release_id: str):
    command = "bash -s -- " + " ".join(
        shlex.quote(value)
        for value in [
            args.remote_root,
            release_id,
            args.service,
            args.domain,
            str(args.keep_backups),
        ]
    )
    stdin, stdout, stderr = client.exec_command(command, get_pty=False)
    stdin.write(REMOTE_DEPLOY_SCRIPT)
    stdin.channel.shutdown_write()
    channel = stdout.channel
    while True:
        if channel.recv_ready():
            data = channel.recv(65536)
            if data:
                sys.stdout.write(data.decode("utf-8", "replace"))
                sys.stdout.flush()
        if channel.recv_stderr_ready():
            data = channel.recv_stderr(65536)
            if data:
                sys.stderr.write(data.decode("utf-8", "replace"))
                sys.stderr.flush()
        if (
            channel.exit_status_ready()
            and not channel.recv_ready()
            and not channel.recv_stderr_ready()
        ):
            break
    code = channel.recv_exit_status()
    if code:
        raise RuntimeError(f"Deployment failed with exit code {code}")


def main():
    args = parse_args()
    validate_remote_inputs(args)
    workspace = checked_workspace(args.workspace)
    revision = git_revision(workspace)
    release_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d-%H%M%S") + "-" + revision
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", release_id):
        raise RuntimeError("Generated release id contains invalid characters")

    print(f"Preparing release {release_id}")
    with tempfile.TemporaryDirectory(prefix="jama-deploy-") as temporary:
        output_dir = pathlib.Path(temporary)
        backend_archive, frontend_archive = build_archives(workspace, output_dir)
        client = connect(args)
        try:
            incoming = f"{args.remote_root}/.deploy/incoming/{release_id}"
            run_remote(
                client,
                "mkdir -p " + shlex.quote(incoming) + " && chmod 700 " + shlex.quote(incoming),
            )
            sftp = client.open_sftp()
            try:
                upload(sftp, backend_archive, f"{incoming}/backend.tar.gz")
                upload(sftp, frontend_archive, f"{incoming}/frontend.tar.gz")
            finally:
                sftp.close()
            run_deployment(client, args, release_id)
        finally:
            client.close()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        sys.exit(1)
