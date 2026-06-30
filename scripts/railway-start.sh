#!/usr/bin/env bash
# Railway worker startup script
# Installs Chromium system deps at container start (Railway nixpacks doesn't
# have a clean way to install apt packages in the build phase without a Dockerfile)
#
# This script is called by railway.toml as the start command.
# It runs as root (Railway containers run as root by default).

set -e

echo "[startup] Installing Chromium system dependencies..."

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
    libglib2.0-0 \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    fonts-liberation \
    fonts-noto-color-emoji \
    > /dev/null 2>&1
rm -rf /var/lib/apt/lists/*

echo "[startup] System deps installed. Starting worker..."
exec bun run worker
