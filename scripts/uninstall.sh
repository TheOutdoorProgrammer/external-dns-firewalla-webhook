#!/bin/bash
#
# Uninstallation script for External-DNS Firewalla Webhook Provider
# This script removes the webhook provider from Firewalla
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
SERVICE_FILE="/etc/systemd/system/external-dns-firewalla-webhook.service"
DNSMASQ_DIR="/home/pi/.firewalla/config/dnsmasq_local"
SUDOERS_FILE="/etc/sudoers.d/external-dns-webhook"

# Parse command line arguments
PURGE=false
if [ "$1" = "--purge" ]; then
    PURGE=true
fi

echo "==========================================="
echo "External-DNS Firewalla Webhook Uninstaller"
echo "==========================================="
echo ""

# Check if running as pi user
if [ "$(whoami)" != "pi" ]; then 
   echo -e "${RED}ERROR: Please run as pi user (not root)${NC}"
   echo "Usage: ./scripts/uninstall.sh [--purge]"
   echo ""
   echo "Options:"
   echo "  --purge    Also remove all DNS records and data"
   echo ""
   echo "The script will ask for sudo password when needed."
   exit 1
fi

# Check if installed
if [ ! -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}WARNING: Installation directory not found${NC}"
    echo "The webhook provider may not be installed"
fi

# Confirmation
echo -e "${YELLOW}This will remove the External-DNS Firewalla Webhook Provider${NC}"
if [ "$PURGE" = true ]; then
    echo -e "${RED}WARNING: --purge flag is set. All DNS records will be deleted!${NC}"
fi
echo ""
read -p "Are you sure you want to continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Uninstallation cancelled"
    exit 0
fi

# Stop service
echo -e "${GREEN}[1/6]${NC} Stopping service..."
echo "Requesting sudo access to stop service..."
if sudo systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null; then
    sudo systemctl stop "$SERVICE_NAME"
    echo "Service stopped"
else
    echo "Service was not running"
fi

# Disable service
echo -e "${GREEN}[2/6]${NC} Disabling service..."
if sudo systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
    sudo systemctl disable "$SERVICE_NAME"
    echo "Service disabled"
else
    echo "Service was not enabled"
fi

# Remove systemd service file
echo -e "${GREEN}[3/6]${NC} Removing systemd service file..."
if [ -f "$SERVICE_FILE" ]; then
    sudo rm -f "$SERVICE_FILE"
    sudo systemctl daemon-reload
    echo "Service file removed"
else
    echo "Service file not found"
fi

# Remove sudoers configuration
echo -e "${GREEN}[4/6]${NC} Removing sudo permissions..."
if [ -f "$SUDOERS_FILE" ]; then
    sudo rm -f "$SUDOERS_FILE"
    echo "Sudo permissions removed"
else
    echo "Sudoers file not found"
fi

# Remove DNS records if --purge
if [ "$PURGE" = true ]; then
    echo -e "${GREEN}[5/6]${NC} Removing DNS records..."
    if [ -d "$DNSMASQ_DIR" ]; then
        # Count files before deletion
        FILE_COUNT=$(find "$DNSMASQ_DIR" -type f | wc -l)
        
        if [ "$FILE_COUNT" -gt 0 ]; then
            echo -e "${RED}WARNING: About to delete $FILE_COUNT DNS record files${NC}"
            read -p "Are you absolutely sure? (type 'yes' to confirm) " -r
            echo
            if [ "$REPLY" = "yes" ]; then
                rm -f "$DNSMASQ_DIR"/*
                echo "DNS records removed"
                
                # Restart DNS service to apply changes
                echo "Restarting firerouter_dns service..."
                sudo systemctl restart firerouter_dns || echo -e "${YELLOW}Warning: Failed to restart DNS service${NC}"
            else
                echo "DNS records preserved"
            fi
        else
            echo "No DNS records found"
        fi
    else
        echo "DNS directory not found"
    fi
else
    echo -e "${GREEN}[5/6]${NC} Preserving DNS records..."
    echo "DNS records kept in: $DNSMASQ_DIR"
    echo -e "${YELLOW}To remove DNS records manually, run: sudo rm -rf $DNSMASQ_DIR/*${NC}"
fi

# Remove installation directory
echo -e "${GREEN}[6/6]${NC} Removing installation directory..."
if [ -d "$INSTALL_DIR" ]; then
    sudo rm -rf "$INSTALL_DIR"
    echo "Installation directory removed"
else
    echo "Installation directory not found"
fi

echo ""
echo "==========================================="
echo -e "${GREEN}Uninstallation completed successfully!${NC}"
echo ""

if [ "$PURGE" = false ]; then
    echo -e "${YELLOW}Note:${NC} DNS records were preserved in $DNSMASQ_DIR"
    echo "To remove them, run: sudo rm -rf $DNSMASQ_DIR/*"
    echo "Then restart DNS: sudo systemctl restart firerouter_dns"
fi

echo ""
echo "The External-DNS Firewalla Webhook Provider has been removed."
