#!/usr/bin/env bash
# 에러 발생 시 즉시 중단
set -o errexit
# Python 버전 3.11로 고정 (3.14는 AI 라이브러리 지원 안 함)
export PYTHON_VERSION=3.11.0
# 1. Node.js 설치 최적화
npm install --prefer-offline --no-audit --no-fund
# 2. Python 패키지 설치
pip install --cache-dir $PYTHON_CACHE_DIR -r requirements.txt
