#!/usr/bin/env bash
set -o errexit
npm install
# 캐시 디렉토리를 사용해서 설치하게 변경
pip install --cache-dir $PYTHON_CACHE_DIR -r requirements.txt
