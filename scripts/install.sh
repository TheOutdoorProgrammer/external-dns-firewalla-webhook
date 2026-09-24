#!/bin/bash
set +x
set -euo pipefail
umask 077

INSTALL_DIR="/opt/external-dns-firewalla-webhook"
SERVICE_NAME="external-dns-firewalla-webhook"
SERVICE_FILE="$SERVICE_NAME.service"
UNIT_FILE="/etc/systemd/system/$SERVICE_FILE"
DNSMASQ_DIR="/home/pi/.firewalla/config/dnsmasq_local"
SUDOERS_FILE="/etc/sudoers.d/external-dns-webhook"
GITHUB_REPO="https://github.com/TheOutdoorProgrammer/external-dns-firewalla-webhook.git"
NODE_PATH="/home/pi/firewalla/bin/node"

fail() {
    printf 'ERROR: %s\n' "$*" >&2
    return 1
}

check_destination() {
    if [[ -e "$INSTALL_DIR" || -L "$INSTALL_DIR" || -e "$UNIT_FILE" || -L "$UNIT_FILE" ]]; then
        fail 'An installation or systemd unit already exists; inspect and preserve it before restoring.'
        return 1
    fi
    if [[ "$(systemctl show --property=LoadState --value "$SERVICE_NAME")" != "not-found" ]]; then
        fail 'The provider is already registered with systemd; refusing to replace it.'
        return 1
    fi
}

write_environment() {
    local source_dir=$1 config_file=$2 secret_file=$3 destination=$4
    local domain_filter shared_secret line
    [[ -f "$config_file" && ! -L "$config_file" && -O "$config_file" ]] || {
        fail 'Domain filter must be a regular file owned by the current user.'; return 1;
    }
    [[ -f "$secret_file" && ! -L "$secret_file" && -O "$secret_file" ]] || {
        fail 'Shared secret must be a regular file owned by the current user.'; return 1;
    }
    [[ "$(stat -c %a "$secret_file")" == 600 ]] || {
        fail 'Shared secret file must have mode 0600.'; return 1;
    }
    domain_filter=$(<"$config_file")
    shared_secret=$(<"$secret_file")
    [[ -n "$domain_filter" && "$domain_filter" != *[!a-zA-Z0-9.,*_-]* ]] || {
        fail 'Domain filter contains unsupported characters.'; return 1;
    }
    [[ ${#shared_secret} -ge 32 && "$shared_secret" != *[!a-zA-Z0-9._~+/=-]* ]] || {
        fail 'Shared secret must contain at least 32 environment-safe characters.'; return 1;
    }
    (
        set -C
        umask 077
        {
            while IFS= read -r line || [[ -n "$line" ]]; do
                case "$line" in
                    DOMAIN_FILTER=*|SHARED_SECRET=*) ;;
                    *) printf '%s\n' "$line" ;;
                esac
            done < "$source_dir/.env.example"
            printf 'DOMAIN_FILTER=%s\n' "$domain_filter"
            printf 'SHARED_SECRET=%s\n' "$shared_secret"
        } > "$destination"
    )
}

install_provider() (
    local config_file=/tmp/external-dns-domain-filter secret_file=/tmp/external-dns-shared-secret source_dir=
    local stage node_version node_major node_minor
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --config-file|--secret-file|--source-dir)
                [[ $# -ge 2 && -n "$2" ]] || { fail "Missing value for $1"; return 1; }
                case "$1" in
                    --config-file) config_file=$2 ;;
                    --secret-file) secret_file=$2 ;;
                    --source-dir) source_dir=$2 ;;
                esac
                shift 2
                ;;
            *) fail 'Usage: install.sh [--source-dir DIR] [--config-file FILE] [--secret-file FILE]'; return 1 ;;
        esac
    done
    [[ "$(whoami)" == pi ]] || { fail 'Run as pi, not root.'; return 1; }
    check_destination
    [[ -x "$NODE_PATH" ]] || { fail 'Firewalla Node executable is missing.'; return 1; }
    node_version=$("$NODE_PATH" -v)
    node_version=${node_version#v}
    IFS=. read -r node_major node_minor _ <<< "$node_version"
    if [[ "$node_major" -lt 12 || ( "$node_major" -eq 12 && "$node_minor" -lt 14 ) ]]; then
        fail 'Node 12.14 or newer is required.'
        return 1
    fi

    stage=$(mktemp -d)
    trap 'rm -r -- "$stage"' EXIT
    if [[ -z "$source_dir" ]]; then
        git clone --depth 1 "$GITHUB_REPO" "$stage/source"
        source_dir="$stage/source"
    fi
    [[ -f "$source_dir/src/server.js" && -f "$source_dir/systemd/$SERVICE_FILE" && -d "$source_dir/node_modules" ]] || {
        fail 'Source package is incomplete; bundled dependencies and systemd unit are required.'; return 1;
    }
    [[ ! -e "$source_dir/.env" && ! -L "$source_dir/.env" ]] || {
        fail 'Source package must not contain an existing .env file.'; return 1;
    }
    write_environment "$source_dir" "$config_file" "$secret_file" "$stage/environment"
    printf 'pi ALL=(ALL) NOPASSWD: /bin/systemctl restart firerouter_dns\n' > "$stage/sudoers"
    printf '# Allow pi user to restart firerouter_dns for external-dns-firewalla-webhook\n' > "$stage/legacy-sudoers"
    cat "$stage/sudoers" >> "$stage/legacy-sudoers"
    sudo visudo -cf "$stage/sudoers"
    if [[ -e "$SUDOERS_FILE" || -L "$SUDOERS_FILE" ]]; then
        if [[ -L "$SUDOERS_FILE" ]] || {
            ! sudo cmp -s "$stage/sudoers" "$SUDOERS_FILE" &&
            ! sudo cmp -s "$stage/legacy-sudoers" "$SUDOERS_FILE"
        }; then
            fail 'Existing provider sudoers entry differs; refusing to replace it.'
            return 1
        fi
    fi

    check_destination
    sudo mkdir -m 0755 "$INSTALL_DIR"
    sudo chown pi:pi "$INSTALL_DIR"
    cp -R "$source_dir/." "$INSTALL_DIR/"
    install -m 0600 "$stage/environment" "$INSTALL_DIR/.env"
    mkdir -p "$DNSMASQ_DIR"
    sudo install -o root -g root -m 0644 "$INSTALL_DIR/systemd/$SERVICE_FILE" "$UNIT_FILE"
    if [[ ! -e "$SUDOERS_FILE" ]]; then
        sudo install -o root -g root -m 0440 "$stage/sudoers" "$SUDOERS_FILE"
    fi
    sudo systemctl daemon-reload
    if [[ "$(sudo systemctl show --property=NoNewPrivileges --value "$SERVICE_NAME")" != no ]]; then
        fail 'Effective NoNewPrivileges would block the DNS restart helper; provider was not started.'
        return 1
    fi
    sudo systemctl enable "$SERVICE_NAME"
    sudo systemctl start "$SERVICE_NAME"
    sudo systemctl is-active --quiet "$SERVICE_NAME"
    printf 'Provider installed and started. Existing DNS records were preserved.\n'
    printf 'Remove the private input files when deployment verification is complete.\n'
)

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
    install_provider "$@"
fi
