#!/usr/bin/env bash
set -o errexit
export PYTHON_VERSION=3.11.0
npm install --prefer-offline --no-audit --no-fund
pip install --cache-dir $PYTHON_CACHE_DIR -r requirements.txt
