#!/bin/bash
#
# Installation script for External-DNS Firewalla Webhook Provider
# This script installs and configures the webhook provider on Firewalla
#
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
INSTALL_DIR="/opt/external-dns-firewalla-webhook"
SERVICE_NAME="external-dns-firewalla-webhook"
SERVICE_FILE="external-dns-firewalla-webhook.service"
DNSMASQ_DIR="/home/pi/.firewalla/config/dnsmasq_local"
SUDOERS_FILE="/etc/sudoers.d/external-dns-webhook"
GITHUB_REPO="https://github.com/TheOutdoorProgrammer/external-dns-firewalla-webhook.git"

echo "========================================="
echo "External-DNS Firewalla Webhook Installer"
echo "========================================="
echo ""

# Check if running as pi user
if [ "$(whoami)" != "pi" ]; then 
   echo -e "${RED}ERROR: Please run as pi user (not root)${NC}"
   echo "Usage: ./scripts/install.sh"
   echo ""
   echo "The script will ask for sudo password when needed."
   exit 1
fi

# Check for Node.js (Firewalla specific path)
echo -e "${GREEN}[1/11]${NC} Checking Node.js installation..."
NODE_PATH="/home/pi/firewalla/bin/node"

if [ ! -f "$NODE_PATH" ]; then
    echo -e "${RED}ERROR: Node.js is not installed at $NODE_PATH${NC}"
    echo "This script requires the Firewalla node installation"
    exit 1
fi

NODE_VERSION=$($NODE_PATH -v | sed 's/v//')
echo "Found Node.js version: $NODE_VERSION at $NODE_PATH"

# Simple version check (requires at least 12.14.0)
NODE_MAJOR=$(echo $NODE_VERSION | cut -d. -f1)
NODE_MINOR=$(echo $NODE_VERSION | cut -d. -f2)

if [ "$NODE_MAJOR" -lt 12 ] || ([ "$NODE_MAJOR" -eq 12 ] && [ "$NODE_MINOR" -lt 14 ]); then
    echo -e "${RED}ERROR: Node.js version 12.14.0 or higher is required${NC}"
    echo "Current version: $NODE_VERSION"
    exit 1
fi

# Check for git
echo -e "${GREEN}[2/11]${NC} Checking for git installation..."
if ! command -v git &> /dev/null; then
    echo -e "${RED}ERROR: git is not installed${NC}"
    echo "Please install git: sudo apt-get install git"
    exit 1
fi

# Check if service is already running
echo -e "${GREEN}[3/9]${NC} Checking for existing installation..."
if systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    echo -e "${YELLOW}WARNING: Service is already running${NC}"
    read -p "Do you want to stop and reinstall? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        echo "Stopping service..."
        sudo systemctl stop "$SERVICE_NAME" || true
    else
        echo "Installation cancelled"
        exit 0
    fi
fi

# Check if directory already exists
if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}WARNING: Installation directory already exists${NC}"
    read -p "Do you want to remove it and reinstall? (y/n) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        sudo rm -rf "$INSTALL_DIR"
    else
        echo "Installation cancelled"
        exit 0
    fi
fi

# Clone repository directly to /opt
echo -e "${GREEN}[4/9]${NC} Cloning repository to $INSTALL_DIR..."
sudo git clone --depth 1 "$GITHUB_REPO" "$INSTALL_DIR"
echo "Repository cloned successfully"

# Set ownership to pi user
sudo chown -R pi:pi "$INSTALL_DIR"

# Create .env file if it doesn't exist
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    echo "Created .env file from .env.example"
fi

# Verify dependencies are present
echo -e "${GREEN}[5/9]${NC} Verifying dependencies..."
if [ ! -d "$INSTALL_DIR/node_modules" ]; then
    echo -e "${RED}ERROR: node_modules not found. The repository may be incomplete.${NC}"
    exit 1
fi
echo "Dependencies verified (bundled in repository)"

# Configure environment
echo -e "${GREEN}[6/9]${NC} Configuring environment..."
if [ ! -s "$INSTALL_DIR/.env" ] || ! grep -q "DOMAIN_FILTER=" "$INSTALL_DIR/.env" || grep -q "DOMAIN_FILTER=example.com" "$INSTALL_DIR/.env"; then
    echo ""
    echo -e "${YELLOW}Please enter your domain filter (comma-separated, e.g., example.com,*.example.com):${NC}"
    read -p "Domain filter: " DOMAIN_FILTER
    
    if [ -z "$DOMAIN_FILTER" ]; then
        echo -e "${RED}ERROR: Domain filter cannot be empty${NC}"
        exit 1
    fi
    
    # Update .env file
    sed -i "s/DOMAIN_FILTER=.*/DOMAIN_FILTER=$DOMAIN_FILTER/" "$INSTALL_DIR/.env"
    echo "Domain filter configured: $DOMAIN_FILTER"
else
    echo "Using existing .env configuration"
fi

# Create dnsmasq directory
echo -e "${GREEN}[7/9]${NC} Creating dnsmasq directory..."
mkdir -p "$DNSMASQ_DIR"
echo "Directory created: $DNSMASQ_DIR"

# Install systemd service
echo -e "${GREEN}[8/9]${NC} Installing systemd service..."
echo "Requesting sudo access to install systemd service..."
sudo cp "$INSTALL_DIR/systemd/$SERVICE_FILE" "/etc/systemd/system/$SERVICE_FILE"
sudo systemctl daemon-reload
echo "Systemd service installed"

# Configure sudoers for DNS service restart
echo "Configuring sudo permissions for DNS service restart..."
sudo bash -c "cat > '$SUDOERS_FILE' << 'EOF'
# Allow pi user to restart firerouter_dns for external-dns-firewalla-webhook
pi ALL=(ALL) NOPASSWD: /bin/systemctl restart firerouter_dns
EOF"
sudo chmod 0440 "$SUDOERS_FILE"
echo "Sudo permissions configured"

# Enable and start service
echo -e "${GREEN}[9/9]${NC} Starting service..."
sudo systemctl enable "$SERVICE_NAME"
sudo systemctl start "$SERVICE_NAME"

# Wait a moment for service to start
sleep 2

# Check service status
echo ""
echo "========================================="
if sudo systemctl is-active --quiet "$SERVICE_NAME"; then
    echo -e "${GREEN}Installation completed successfully!${NC}"
    echo ""
    echo "Service status:"
    sudo systemctl status "$SERVICE_NAME" --no-pager -l | head -n 10
    echo ""
    echo -e "${GREEN}Next steps:${NC}"
    echo "1. Configure external-dns in your Kubernetes cluster to use this webhook"
    echo "2. Set the webhook endpoint to: http://<firewalla-ip>:8888"
    echo "3. Monitor logs with: sudo journalctl -u $SERVICE_NAME -f"
    echo ""
    echo "For more information, see: $INSTALL_DIR/README.md"
else
    echo -e "${RED}Installation completed but service failed to start${NC}"
    echo ""
    echo "Check the logs with: sudo journalctl -u $SERVICE_NAME -n 50"
    exit 1
fi
