#!/usr/bin/env bash
# 에러 발생 시 즉시 중단
set -o errexit

# 1. Node.js 설치 최적화
# --prefer-offline: 로컬 캐시에 있으면 인터넷 연결 안 하고 바로 설치
# --no-audit: 보안 검사 생략 (시간 단축)
# --no-fund: 후원 메시지 출력 생략
npm install --prefer-offline --no-audit --no-fund

# 2. Python 설치 (기존 캐시 설정 유지)
pip install --cache-dir $PYTHON_CACHE_DIR -r requirements.txt
