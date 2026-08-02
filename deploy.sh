#!/usr/bin/env bash
set -euo pipefail

server_host="101.35.214.179"
ssh_port="22"
ssh_user="root"
identity_file=""
remote_root="/www/wwwroot/jama.artisoul.top"
service="jama.service"
domain="jama.artisoul.top"
host_key=""
keep_backups="5"
skip_tests=0
skip_audit=0
strict_audit=0
preflight_only=0
bundle_warning_kb="500"
bundle_limit_kb="2048"
python_bin="${PYTHON:-}"

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [options]

Build, test, package, and deploy JamaAI from macOS/Linux.

Options:
  --server-host HOST        SSH host (default: 101.35.214.179)
  --ssh-port PORT           SSH port (default: 22)
  --ssh-user USER           SSH user (default: root)
  --identity-file PATH      SSH private key path. If omitted, prompts for password.
  --remote-root PATH        Remote site root (default: /www/wwwroot/jama.artisoul.top)
  --service NAME            systemd service name (default: jama.service)
  --domain DOMAIN           Public domain for HTTPS health check (default: jama.artisoul.top)
  --host-key FINGERPRINT    Expected SSH host key fingerprint.
  --keep-backups N          Number of remote backups to keep (default: 5)
  --skip-tests              Skip backend and frontend tests.
  --skip-audit              Skip npm production dependency audit.
  --strict-audit            Fail when audit is unavailable or media tools are missing.
  --preflight-only          Run local checks and build only; do not connect to server.
  --bundle-warning-kb N     Warn when largest frontend JS exceeds N KiB (default: 500)
  --bundle-limit-kb N       Fail when largest frontend JS exceeds N KiB (default: 2048)
  --python PATH             Python interpreter to use (default: python3, then python)
  -h, --help                Show this help.

Authentication:
  Password: ./deploy.sh
  SSH key:  ./deploy.sh --identity-file ~/.ssh/id_ed25519

You can also set JAMA_DEPLOY_SSH_PASSWORD before running to avoid the prompt.
EOF
}

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

warn() {
  printf 'WARNING: %s\n' "$*" >&2
}

require_value() {
  if [ "$#" -lt 2 ] || [ -z "${2:-}" ]; then
    fail "$1 requires a value"
  fi
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --server-host)
      require_value "$1" "${2:-}"
      server_host="$2"
      shift 2
      ;;
    --server-host=*)
      server_host="${1#*=}"
      shift
      ;;
    --ssh-port)
      require_value "$1" "${2:-}"
      ssh_port="$2"
      shift 2
      ;;
    --ssh-port=*)
      ssh_port="${1#*=}"
      shift
      ;;
    --ssh-user)
      require_value "$1" "${2:-}"
      ssh_user="$2"
      shift 2
      ;;
    --ssh-user=*)
      ssh_user="${1#*=}"
      shift
      ;;
    --identity-file)
      require_value "$1" "${2:-}"
      identity_file="$2"
      shift 2
      ;;
    --identity-file=*)
      identity_file="${1#*=}"
      shift
      ;;
    --remote-root)
      require_value "$1" "${2:-}"
      remote_root="$2"
      shift 2
      ;;
    --remote-root=*)
      remote_root="${1#*=}"
      shift
      ;;
    --service)
      require_value "$1" "${2:-}"
      service="$2"
      shift 2
      ;;
    --service=*)
      service="${1#*=}"
      shift
      ;;
    --domain)
      require_value "$1" "${2:-}"
      domain="$2"
      shift 2
      ;;
    --domain=*)
      domain="${1#*=}"
      shift
      ;;
    --host-key)
      require_value "$1" "${2:-}"
      host_key="$2"
      shift 2
      ;;
    --host-key=*)
      host_key="${1#*=}"
      shift
      ;;
    --keep-backups)
      require_value "$1" "${2:-}"
      keep_backups="$2"
      shift 2
      ;;
    --keep-backups=*)
      keep_backups="${1#*=}"
      shift
      ;;
    --skip-tests)
      skip_tests=1
      shift
      ;;
    --skip-audit)
      skip_audit=1
      shift
      ;;
    --strict-audit)
      strict_audit=1
      shift
      ;;
    --preflight-only)
      preflight_only=1
      shift
      ;;
    --bundle-warning-kb)
      require_value "$1" "${2:-}"
      bundle_warning_kb="$2"
      shift 2
      ;;
    --bundle-warning-kb=*)
      bundle_warning_kb="${1#*=}"
      shift
      ;;
    --bundle-limit-kb)
      require_value "$1" "${2:-}"
      bundle_limit_kb="$2"
      shift 2
      ;;
    --bundle-limit-kb=*)
      bundle_limit_kb="${1#*=}"
      shift
      ;;
    --python)
      require_value "$1" "${2:-}"
      python_bin="$2"
      shift 2
      ;;
    --python=*)
      python_bin="${1#*=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      fail "Unknown option: $1"
      ;;
  esac
done

case "$ssh_port" in
  ''|*[!0-9]*) fail "--ssh-port must be a positive integer" ;;
esac
case "$keep_backups" in
  ''|*[!0-9]*) fail "--keep-backups must be a positive integer" ;;
esac
case "$bundle_warning_kb" in
  ''|*[!0-9]*) fail "--bundle-warning-kb must be a positive integer" ;;
esac
case "$bundle_limit_kb" in
  ''|*[!0-9]*) fail "--bundle-limit-kb must be a positive integer" ;;
esac
if [ "$skip_audit" -eq 1 ] && [ "$strict_audit" -eq 1 ]; then
  fail "--skip-audit and --strict-audit cannot be used together"
fi
if [ "$bundle_warning_kb" -le 0 ]; then
  fail "--bundle-warning-kb must be greater than zero"
fi
if [ "$bundle_limit_kb" -lt "$bundle_warning_kb" ]; then
  fail "--bundle-limit-kb must be greater than or equal to --bundle-warning-kb"
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
workspace="$script_dir"
backend="$workspace/backend-node"
frontend="$workspace/frontweb"
helper="$workspace/tools/deploy_jama.py"

run_checked() {
  workdir="$1"
  shift
  (
    cd "$workdir"
    "$@"
  )
}

require_command() {
  name="$1"
  command -v "$name" >/dev/null 2>&1 || fail "$name was not found in PATH"
}

require_command node
require_command npm
if [ -z "$python_bin" ]; then
  if command -v python3 >/dev/null 2>&1; then
    python_bin="$(command -v python3)"
  elif command -v python >/dev/null 2>&1; then
    python_bin="$(command -v python)"
  else
    fail "Python was not found in PATH"
  fi
fi

if [ ! -f "$helper" ]; then
  fail "Deployment helper not found: $helper"
fi

if [ ! -d "$backend/node_modules" ]; then
  printf 'Installing backend dependencies...\n'
  run_checked "$backend" npm ci
fi
if [ ! -d "$frontend/node_modules" ]; then
  printf 'Installing frontend dependencies...\n'
  run_checked "$frontend" npm ci
fi

if [ "$skip_tests" -eq 0 ]; then
  printf 'Running backend tests...\n'
  backend_tests=()
  while IFS= read -r file; do
    backend_tests+=("$file")
  done < <(find "$backend/test" -type f -name '*.test.js' | sort)
  run_checked "$backend" node --test "${backend_tests[@]}"

  printf 'Running frontend tests...\n'
  frontend_tests=()
  while IFS= read -r file; do
    frontend_tests+=("$file")
  done < <(find "$frontend/test" -type f -name '*.test.js' | sort)
  run_checked "$frontend" node --test "${frontend_tests[@]}"
fi

audit_dependencies() {
  workdir="$1"
  component="$2"
  audit_file="$(mktemp "${TMPDIR:-/tmp}/jama-audit.XXXXXX")"
  trap 'rm -f "$audit_file"' RETURN

  printf 'Auditing %s production dependencies...\n' "$component"
  set +e
  (
    cd "$workdir"
    npm audit \
      --registry=https://registry.npmjs.org \
      --omit=dev \
      --audit-level=high \
      --json \
      --loglevel=error
  ) >"$audit_file" 2>&1
  audit_status=$?
  set -e

  set +e
  parse_output="$(
    node - "$audit_file" <<'NODE'
const fs = require('fs');
const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
let report;
try {
  report = JSON.parse(text);
} catch (_) {
  process.exit(2);
}
const vulnerabilities = report?.metadata?.vulnerabilities;
if (!vulnerabilities) {
  process.exit(3);
}
const critical = Number(vulnerabilities.critical || 0);
const high = Number(vulnerabilities.high || 0);
const moderate = Number(vulnerabilities.moderate || 0);
const low = Number(vulnerabilities.low || 0);
console.log(`${critical} ${high} ${moderate} ${low}`);
NODE
  )"
  parse_status=$?
  set -e

  if [ "$parse_status" -ne 0 ]; then
    message="Dependency audit did not return a valid report for $component (exit code $audit_status)."
    if [ "$strict_audit" -eq 1 ]; then
      fail "$message"
    fi
    warn "$message Deployment will continue; use --strict-audit to fail closed."
    rm -f "$audit_file"
    trap - RETURN
    return
  fi

  set -- $parse_output
  critical="$1"
  high="$2"
  moderate="$3"
  low="$4"
  summary="critical=$critical, high=$high, moderate=$moderate, low=$low"

  if [ "$critical" -gt 0 ] || [ "$high" -gt 0 ]; then
    message="Production dependency audit found vulnerabilities in $component: $summary."
    if [ "$strict_audit" -eq 1 ]; then
      fail "$message"
    fi
    warn "$message Deployment will continue in non-strict mode."
  elif [ "$audit_status" -ne 0 ]; then
    message="Dependency audit exited with code $audit_status despite reporting no high-risk vulnerabilities for $component."
    if [ "$strict_audit" -eq 1 ]; then
      fail "$message"
    fi
    warn "$message Deployment will continue in non-strict mode."
  else
    printf 'Dependency audit passed for %s: %s\n' "$component" "$summary"
  fi

  rm -f "$audit_file"
  trap - RETURN
}

if [ "$skip_audit" -eq 0 ]; then
  audit_dependencies "$backend" "backend"
  audit_dependencies "$frontend" "frontend"
fi

resolve_media_tool() {
  tool_name="$1"
  env_name="$2"
  override="${!env_name:-}"
  if [ -n "$override" ] && [ -f "$override" ]; then
    printf '%s\n' "$override"
    return 0
  fi

  bundled="$backend/tools/ffmpeg/$tool_name"
  if [ -f "$bundled" ]; then
    printf '%s\n' "$bundled"
    return 0
  fi

  command -v "$tool_name" 2>/dev/null || true
}

check_media_tools() {
  printf 'Checking FFmpeg media tools...\n'
  missing=()
  for tool_name in ffmpeg ffprobe; do
    env_name="FFMPEG_PATH"
    if [ "$tool_name" = "ffprobe" ]; then
      env_name="FFPROBE_PATH"
    fi
    resolved="$(resolve_media_tool "$tool_name" "$env_name")"
    if [ -z "$resolved" ]; then
      missing+=("$tool_name")
      continue
    fi
    "$resolved" -version >/dev/null 2>&1 || fail "$tool_name exists but failed its version check: $resolved"
    printf 'Media tool ready: %s (%s)\n' "$tool_name" "$resolved"
  done

  if [ "${#missing[@]}" -gt 0 ]; then
    message="Missing media tools: ${missing[*]}. Video merge, subtitles, dubbing, or media inspection may be unavailable."
    if [ "$strict_audit" -eq 1 ]; then
      fail "$message"
    fi
    warn "$message"
  fi
}

check_media_tools

printf 'Building frontend...\n'
run_checked "$frontend" npm run build

node - "$frontend/dist" "$bundle_warning_kb" "$bundle_limit_kb" <<'NODE'
const fs = require('fs');
const path = require('path');

const dist = process.argv[2];
const warningKb = Number(process.argv[3]);
const limitKb = Number(process.argv[4]);
const assets = path.join(dist, 'assets');

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

if (!fs.existsSync(assets)) {
  console.error(`No assets directory was produced in ${dist}.`);
  process.exit(2);
}

const bundles = walk(assets)
  .map((file) => ({ file, size: fs.statSync(file).size }))
  .sort((a, b) => b.size - a.size);
if (!bundles.length) {
  console.error(`No JavaScript bundle was produced in ${assets}.`);
  process.exit(2);
}

const largest = bundles[0];
const sizeKb = Math.round((largest.size / 1024) * 10) / 10;
console.log(`Largest frontend JavaScript bundle: ${path.basename(largest.file)} (${sizeKb} KiB)`);
if (largest.size > limitKb * 1024) {
  console.error(`Frontend bundle exceeds the deployment limit of ${limitKb} KiB.`);
  process.exit(2);
}
if (largest.size > warningKb * 1024) {
  console.error(`WARNING: Frontend bundle exceeds ${warningKb} KiB. Consider route-level dynamic imports or Rollup manualChunks.`);
}
NODE

if [ "$preflight_only" -eq 1 ]; then
  printf 'Preflight completed successfully; no server changes were made.\n'
  exit 0
fi

python_package_root="${JAMA_DEPLOY_PYTHON_ROOT:-$HOME/Library/Caches/JamaDeploy/python}"
mkdir -p "$python_package_root"

old_pythonpath="${PYTHONPATH:-}"
old_pythonpath_was_set=0
if [ "${PYTHONPATH+x}" = "x" ]; then
  old_pythonpath_was_set=1
fi
password_was_prompted=0

cleanup_env() {
  if [ "$password_was_prompted" -eq 1 ]; then
    unset JAMA_DEPLOY_SSH_PASSWORD
  fi
  if [ "$old_pythonpath_was_set" -eq 1 ]; then
    export PYTHONPATH="$old_pythonpath"
  else
    unset PYTHONPATH
  fi
}
trap cleanup_env EXIT

export PYTHONPATH="$python_package_root${PYTHONPATH:+:$PYTHONPATH}"

if ! "$python_bin" -c 'import paramiko' >/dev/null 2>&1; then
  printf 'Installing the isolated SSH deployment dependency...\n'
  "$python_bin" -m pip install --quiet --disable-pip-version-check --upgrade --target "$python_package_root" \
    "paramiko>=3.5,<5" "cryptography<47" \
    || fail "Failed to install the SSH deployment dependency."
fi

if [ -z "$identity_file" ] && [ -z "${JAMA_DEPLOY_SSH_PASSWORD:-}" ]; then
  if [ ! -r /dev/tty ]; then
    fail "No interactive terminal is available for SSH password input. Set JAMA_DEPLOY_SSH_PASSWORD or use --identity-file."
  fi
  IFS= read -r -s -p "SSH password for $ssh_user@$server_host: " ssh_password < /dev/tty
  printf '\n' >&2
  if [ -z "$ssh_password" ]; then
    fail "SSH password cannot be empty. Set JAMA_DEPLOY_SSH_PASSWORD or use --identity-file."
  fi
  export JAMA_DEPLOY_SSH_PASSWORD="$ssh_password"
  password_was_prompted=1
fi

deploy_args=(
  "$helper"
  "--workspace" "$workspace"
  "--host" "$server_host"
  "--port" "$ssh_port"
  "--user" "$ssh_user"
  "--remote-root" "$remote_root"
  "--service" "$service"
  "--domain" "$domain"
  "--keep-backups" "$keep_backups"
)
if [ -n "$identity_file" ]; then
  deploy_args+=("--identity-file" "$identity_file")
fi
if [ -n "$host_key" ]; then
  deploy_args+=("--host-key" "$host_key")
fi

"$python_bin" "${deploy_args[@]}"

printf 'Deployment completed successfully: https://%s\n' "$domain"
