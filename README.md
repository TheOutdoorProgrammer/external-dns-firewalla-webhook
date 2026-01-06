# External-DNS Firewalla Webhook Provider

A webhook provider for [external-dns](https://github.com/kubernetes-sigs/external-dns) that manages DNS records on Firewalla devices via dnsmasq configuration files.

## Overview

This webhook provider allows Kubernetes external-dns to automatically create, update, and delete DNS records on your Firewalla device. It's perfect for home labs and small deployments where you want to use your Firewalla as the authoritative DNS server for your local domains.

### How It Works

1. External-DNS running in your Kubernetes cluster detects services/ingresses that need DNS records
2. External-DNS sends webhook requests to this provider running on your Firewalla
3. The provider translates these requests into dnsmasq configuration files
4. DNS records are immediately available on your network via Firewalla's DNS server

### Features

- ✅ Automatic DNS record management for Kubernetes resources
- ✅ Support for A records (IPv4 addresses)
- ✅ Support for TXT records (for external-dns ownership tracking)
- ✅ Multiple IP addresses per domain name
- ✅ Configurable domain filters
- ✅ Safe concurrent request handling
- ✅ Systemd service management
- ✅ Simple installation and uninstallation
- ✅ Comprehensive logging via systemd journal
- ✅ Dry-run mode for testing

## Prerequisites

- **Firewalla device** (Gold, Purple, Red, or any model with SSH access)
- **Firewalla firmware** with Node.js at `/home/pi/firewalla/bin/node` (pre-installed on most models)
- **Kubernetes cluster** with external-dns installed
- **SSH access** to your Firewalla device as the `pi` user
- **Sudo privileges** on Firewalla

## Quick Start

### One-Line Installation

SSH into your Firewalla as the `pi` user and run:

```bash
curl -fsSL https://raw.githubusercontent.com/TheOutdoorProgrammer/external-dns-firewalla-webhook/main/scripts/install.sh | bash
```

**Note**: The script will prompt for your sudo password when needed for system configuration.

This will:
- Clone the repository (with bundled dependencies)
- Verify dependencies
- Configure the service (with sudo)
- Prompt for your domain filter
- Start the webhook provider

**Note**: Dependencies (Express.js) are bundled in the repository since npm is not available on Firewalla.

### Manual Installation

If you prefer to review the installation script first:

1. SSH into your Firewalla device as the `pi` user:
   ```bash
   ssh pi@<firewalla-ip>
   ```

2. Clone this repository:
   ```bash
   git clone https://github.com/TheOutdoorProgrammer/external-dns-firewalla-webhook.git
   cd external-dns-firewalla-webhook
   ```

3. Review the installation script:
   ```bash
   cat scripts/install.sh
   ```

4. Run the installation script (as pi user, not root):
   ```bash
   ./scripts/install.sh
   ```
   
   The script will ask for your sudo password when needed.

5. Follow the prompts to configure your domain filter (e.g., `home.local,*.home.local`)

6. Verify the service is running:
   ```bash
   sudo systemctl status external-dns-firewalla-webhook
   ```

### Configuration in Kubernetes

#### Using Helm Chart (Recommended)

Add this configuration to your `external-dns` Helm values:

```yaml
provider:
  name: webhook
  webhook:
    image:
      repository: registry.k8s.io/external-dns/external-dns
      tag: v0.14.0
    env:
      - name: WEBHOOK_HOST
        value: "<firewalla-ip>:8888"
    livenessProbe:
      httpGet:
        path: /healthz
        port: 8080
      initialDelaySeconds: 10
      timeoutSeconds: 5
    readinessProbe:
      httpGet:
        path: /healthz
        port: 8080
      initialDelaySeconds: 10
      timeoutSeconds: 5

# Your domain filter (must match Firewalla webhook config)
domainFilters:
  - home.local

# Source configuration
sources:
  - service
  - ingress

# Recommended settings
policy: sync
registry: txt
txtOwnerId: my-k8s-cluster
txtPrefix: external-dns-
```

Install or upgrade external-dns:

```bash
helm repo add external-dns https://kubernetes-sigs.github.io/external-dns/
helm upgrade --install external-dns external-dns/external-dns \
  -f values.yaml \
  -n external-dns \
  --create-namespace
```

#### Using Raw Kubernetes Manifests

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: external-dns
  namespace: external-dns
spec:
  strategy:
    type: Recreate
  selector:
    matchLabels:
      app: external-dns
  template:
    metadata:
      labels:
        app: external-dns
    spec:
      serviceAccountName: external-dns
      containers:
      - name: external-dns
        image: registry.k8s.io/external-dns/external-dns:v0.14.0
        args:
        - --source=service
        - --source=ingress
        - --domain-filter=home.local
        - --provider=webhook
        - --webhook-server=http://<firewalla-ip>:8888
        - --policy=sync
        - --registry=txt
        - --txt-owner-id=my-k8s-cluster
        - --txt-prefix=external-dns-
        - --log-level=info
        livenessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 10
        readinessProbe:
          httpGet:
            path: /healthz
            port: 8080
          initialDelaySeconds: 10
```

### Testing

1. Create a test service in Kubernetes:

```yaml
apiVersion: v1
kind: Service
metadata:
  name: nginx-test
  annotations:
    external-dns.alpha.kubernetes.io/hostname: nginx.home.local
spec:
  type: LoadBalancer
  ports:
  - port: 80
    targetPort: 80
  selector:
    app: nginx
```

2. Apply the service:
```bash
kubectl apply -f test-service.yaml
```

3. Check external-dns logs:
```bash
kubectl logs -n external-dns -l app=external-dns
```

4. Verify DNS record was created on Firewalla:
```bash
# SSH to Firewalla
ssh pi@<firewalla-ip>

# Check the DNS record file
cat ~/.firewalla/config/dnsmasq_local/nginx.home.local

# Test DNS resolution
dig @localhost nginx.home.local
```

## Configuration

### Environment Variables

The webhook provider is configured via the `.env` file located at `/opt/external-dns-firewalla-webhook/.env`.

#### Required Variables

- `DOMAIN_FILTER`: Comma-separated list of domains to manage (e.g., `home.local,*.home.local`)

#### Optional Variables

- `PORT_PROVIDER`: Provider API port (default: `8888`)
- `PORT_HEALTH`: Health check port (default: `8080`)
- `DNS_TTL`: Default TTL for DNS records in seconds (default: `300`)
- `DNSMASQ_DIR`: Path to dnsmasq config directory (default: `/home/pi/.firewalla/config/dnsmasq_local`)
- `LOG_LEVEL`: Log level - `error`, `warn`, `info`, or `debug` (default: `info`)
- `DRY_RUN`: If `true`, don't make actual changes (default: `false`)

### Editing Configuration

1. Edit the .env file:
   ```bash
   sudo nano /opt/external-dns-firewalla-webhook/.env
   ```

2. Restart the service:
   ```bash
   sudo systemctl restart external-dns-firewalla-webhook
   ```

## Management

### Viewing Logs

```bash
# Follow live logs
sudo journalctl -u external-dns-firewalla-webhook -f

# View recent logs
sudo journalctl -u external-dns-firewalla-webhook -n 100

# View logs with timestamps
sudo journalctl -u external-dns-firewalla-webhook -e --no-pager
```

### Service Management

```bash
# Check service status
sudo systemctl status external-dns-firewalla-webhook

# Start service
sudo systemctl start external-dns-firewalla-webhook

# Stop service
sudo systemctl stop external-dns-firewalla-webhook

# Restart service
sudo systemctl restart external-dns-firewalla-webhook

# Enable service (start on boot)
sudo systemctl enable external-dns-firewalla-webhook

# Disable service
sudo systemctl disable external-dns-firewalla-webhook
```

### Viewing DNS Records

All DNS records managed by this webhook are stored as files in `/home/pi/.firewalla/config/dnsmasq_local/`:

```bash
# List all DNS records
ls -la ~/.firewalla/config/dnsmasq_local/

# View a specific record
cat ~/.firewalla/config/dnsmasq_local/nginx.home.local

# Count total records
ls ~/.firewalla/config/dnsmasq_local/ | wc -l
```

## Uninstallation

### One-Line Uninstall (Preserves DNS Records)

SSH into your Firewalla as the `pi` user and run:

```bash
curl -fsSL https://raw.githubusercontent.com/TheOutdoorProgrammer/external-dns-firewalla-webhook/main/scripts/uninstall.sh | bash
```

**Note**: The script will prompt for your sudo password when needed.

This removes the service but **keeps** your DNS records in case you want to reinstall later.

### One-Line Complete Removal (Deletes All DNS Records)

⚠️ **WARNING**: This will delete all DNS records managed by this webhook!

```bash
curl -fsSL https://raw.githubusercontent.com/TheOutdoorProgrammer/external-dns-firewalla-webhook/main/scripts/uninstall.sh | bash -s -- --purge
```

### Manual Uninstall

If the webhook is already installed locally, run as the `pi` user (not root):

**Standard uninstall (preserves DNS records):**
```bash
cd /opt/external-dns-firewalla-webhook
./scripts/uninstall.sh
```

**Complete removal (deletes DNS records):**
```bash
cd /opt/external-dns-firewalla-webhook
./scripts/uninstall.sh --purge
```

The script will ask for your sudo password when needed.

## Architecture

### Components

1. **Express.js Server**: Implements the external-dns webhook protocol
   - Provider API (port 8888): Handles DNS record operations
   - Health API (port 8080): Kubernetes health checks

2. **Dnsmasq Service**: Manages DNS record files
   - Creates/updates/deletes files in `~/.firewalla/config/dnsmasq_local/`
   - Restarts `firerouter_dns` service to apply changes

3. **Systemd Service**: Ensures the webhook provider runs continuously
   - Auto-restart on failure
   - Starts on system boot
   - Logs to systemd journal

### API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/` | GET | Negotiate domain filters with external-dns |
| `/records` | GET | Retrieve current DNS records |
| `/records` | POST | Apply DNS record changes (create/update/delete) |
| `/adjustendpoints` | POST | Filter unsupported record types |
| `/healthz` | GET | Health check for Kubernetes probes |

### DNS Record Format

#### A Records
File: `~/.firewalla/config/dnsmasq_local/example.home.local`
```
address=/example.home.local/192.168.1.100
address=/example.home.local/192.168.1.101
```

#### TXT Records  
File: `~/.firewalla/config/dnsmasq_local/external-dns-a-example.home.local.txt`
```
txt-record=external-dns-a-example.home.local,"heritage=external-dns,external-dns/owner=my-cluster"
```

## Troubleshooting

### Service Won't Start

1. Check the logs:
   ```bash
   sudo journalctl -u external-dns-firewalla-webhook -n 50
   ```

2. Verify Node.js is installed at the Firewalla path:
   ```bash
   /home/pi/firewalla/bin/node -v  # Should be 12.14.0 or higher
   ```

3. Check the .env file:
   ```bash
   cat /opt/external-dns-firewalla-webhook/.env
   ```

4. Ensure DOMAIN_FILTER is set:
   ```bash
   grep DOMAIN_FILTER /opt/external-dns-firewalla-webhook/.env
   ```

### DNS Records Not Created

1. Check external-dns logs in Kubernetes:
   ```bash
   kubectl logs -n external-dns -l app=external-dns --tail=100
   ```

2. Verify webhook connectivity from Kubernetes:
   ```bash
   # From a pod in your cluster
   curl http://<firewalla-ip>:8888/healthz
   ```

3. Check webhook provider logs:
   ```bash
   sudo journalctl -u external-dns-firewalla-webhook -f
   ```

4. Verify domain filter matches:
   - Webhook `.env`: `DOMAIN_FILTER=home.local`
   - External-DNS: `--domain-filter=home.local`

### DNS Service Restart Fails

1. Check if you have sudo permissions:
   ```bash
   sudo -l | grep firerouter_dns
   ```

2. Manually test the restart command:
   ```bash
   sudo systemctl restart firerouter_dns
   ```

3. Verify the sudoers file:
   ```bash
   cat /etc/sudoers.d/external-dns-webhook
   ```

### Port Already in Use

If ports 8888 or 8080 are already in use:

1. Edit the .env file:
   ```bash
   sudo nano /opt/external-dns-firewalla-webhook/.env
   ```

2. Change `PORT_PROVIDER` or `PORT_HEALTH` to different values

3. Restart the service:
   ```bash
   sudo systemctl restart external-dns-firewalla-webhook
   ```

4. Update your external-dns configuration to use the new port

## Security Considerations

1. **Network Access**: The webhook provider binds to `0.0.0.0`, making it accessible from your entire network. Ensure your Firewalla firewall rules restrict access to only your Kubernetes cluster.

2. **Sudo Permissions**: The service requires sudo access to restart `firerouter_dns`. This is limited to only that specific command via sudoers configuration.

3. **Input Validation**: All DNS names and IP addresses are validated before being written to files to prevent path traversal and injection attacks.

4. **File Permissions**: DNS record files are created with 644 permissions (readable by all, writable by owner).

## Advanced Usage

### Dry Run Mode

Test the webhook without making actual changes:

1. Enable dry run:
   ```bash
   sudo nano /opt/external-dns-firewalla-webhook/.env
   # Set: DRY_RUN=true
   ```

2. Restart the service:
   ```bash
   sudo systemctl restart external-dns-firewalla-webhook
   ```

3. Watch the logs to see what would be changed:
   ```bash
   sudo journalctl -u external-dns-firewalla-webhook -f
   ```

### Multiple Domains

Configure multiple domain filters:

```bash
DOMAIN_FILTER=home.local,*.home.local,lab.local,*.lab.local
```

### Debug Logging

Enable detailed debug logging:

```bash
# Edit .env
sudo nano /opt/external-dns-firewalla-webhook/.env
# Set: LOG_LEVEL=debug

# Restart service
sudo systemctl restart external-dns-firewalla-webhook

# Watch debug logs
sudo journalctl -u external-dns-firewalla-webhook -f
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/TheOutdoorProgrammer/external-dns-firewalla-webhook.git
   cd external-dns-firewalla-webhook
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a .env file:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. Run in development mode:
   ```bash
   npm run dev
   ```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [external-dns](https://github.com/kubernetes-sigs/external-dns) - Kubernetes external-dns project
- [Firewalla](https://firewalla.com/) - Smart firewall and router platform
- The Kubernetes community

## Support

- **Issues**: [GitHub Issues](https://github.com/TheOutdoorProgrammer/external-dns-firewalla-webhook/issues)
- **Discussions**: [GitHub Discussions](https://github.com/TheOutdoorProgrammer/external-dns-firewalla-webhook/discussions)

## Changelog

### v1.0.0 (Initial Release)

- External-DNS webhook provider implementation
- Support for A and TXT records
- Multiple IP addresses per domain
- Systemd service management
- Installation and uninstallation scripts
- Comprehensive logging
- Dry-run mode
- Concurrent request handling
