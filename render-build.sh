#!/usr/bin/env bash
set -o errexit
# ffmpeg 설치 (프레임 추출용)
export PYTHON_VERSION=3.11.0
npm install --prefer-offline --no-audit --no-fund
pip install -r requirements.txt
