# 🦺 Watch Out!! - 스마트 현장 안전관제 시스템

> AI 기반 실시간 위험 감지 및 자동 인수인계 보고서 시스템

---

## 📌 프로젝트 소개

산업 현장에서 교대 근무 간 안전 공백을 없애기 위해 개발한 스마트 안전관제 시스템입니다.  
YOLO AI 모델을 활용하여 실시간으로 위험 상황을 감지하고 자동으로 보고서를 생성하여 디지털 인수인계가 가능하도록 설계되었습니다.

---

## 🛠 기술 스택

| 구분 | 기술 |
|------|------|
| Frontend | HTML, CSS, JavaScript |
| Backend | Node.js v22.19.0, Express.js |
| AI 분석 | Python, Flask, YOLOv8 (ultralytics) |
| Database | MySQL (Railway) |
| 이미지 저장 | Cloudinary |
| SMS 발송 | Solapi |
| 배포 | Render |
| 버전 관리 | GitHub |

---

## 📦 주요 라이브러리

### Node.js
```json
{
  "express": "^4.18.2",
  "mysql2": "^3.6.0",
  "cloudinary": "^1.41.0",
  "multer": "^1.4.5",
  "axios": "^1.6.0",
  "jsonwebtoken": "^9.0.2",
  "dotenv": "^16.3.1",
  "cors": "^2.8.5"
}
```

### Python
```
ultralytics
flask
opencv-python
numpy
shapely
scikit-learn
```

---

## ⚙️ 실행 방법

### 환경변수 설정 (.env)
```
PORT=10000
MYSQLHOST=junction.proxy.rlwy.net
MYSQLUSER=root
MYSQLPASSWORD=your_password
MYSQLDATABASE=railway
MYSQLPORT=50160

CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

COOLSMS_API_KEY=your_api_key
COOLSMS_API_SECRET=your_api_secret
COOLSMS_FROM=your_phone_number

ADMIN_PHONE=01033778529
ADMIN2_PHONE=01071279061
WORKER_PHONE=01077215981

JWT_SECRET=smart_safe_key
AI_SERVER_URL=http://localhost:5001
```

### 서버 실행
```bash
# Node.js 패키지 설치
npm install

# 서버 실행
node server.js
```

### Flask AI 서버 실행
```bash
# Python 패키지 설치
pip install -r requirements.txt

# AI 서버 실행
python AI_engine/app.py
```

---

## 🌐 배포 주소

```
https://safety-server-oqza.onrender.com
```

---

## 👥 팀 구성 (1조)

| 역할 | 이름 |
|------|------|
| 조장 / DB 설계 | 정재학 |
| 풀스택 개발 | 손광민 |
| AI 모델 | 김수연 |

---

## 📁 프로젝트 구조

```
safety-server/
├── server.js          # Node.js 메인 서버
├── public/            # 프론트엔드 HTML 파일
│   ├── login.html
│   ├── upload.html    # 현장 모니터링
│   ├── handover.html  # 인수인계
│   ├── report-detail.html
│   ├── reports.html   # AI 보고서
│   ├── dashboard.html # 통계실
│   ├── archive.html   # 보고서 기록실
│   └── slides/        # 슬라이드 시연 사진
├── AI_engine/         # Flask AI 서버
│   ├── app.py
│   ├── detect_quick.py
│   ├── safety2.pt     # YOLO 모델
│   └── ...
├── requirements.txt   # Python 패키지 목록
└── package.json       # Node.js 패키지 목록
```

---

## 🔍 주요 기능

- **실시간 위험 감지**: YOLO AI 모델로 3초마다 현장 분석
- **5가지 위험 케이스 감지**: 안전복 미착용, 위험구역 출입, 중장비 접근, 자재물 적치, 작업자 밀집
- **자동 SMS 발송**: 위험 감지 시 관리자 3명에게 즉시 발송
- **세션별 보고서 자동 생성**: 오전/오후/야간 교대 근무별 자동 생성
- **디지털 인수인계**: 본인 인증 후 인수인계 승인
- **자료실**: AI 보고서, 통계실, 보고서 기록실
