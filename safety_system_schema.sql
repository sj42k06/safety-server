CREATE DATABASE IF NOT EXISTS safety_system;
USE safety_system;

DROP VIEW IF EXISTS zone_risk_stats;

DROP TABLE IF EXISTS report_risks;
DROP TABLE IF EXISTS handover_reports;
DROP TABLE IF EXISTS risk_analysis;
DROP TABLE IF EXISTS risks;
DROP TABLE IF EXISTS zones;
DROP TABLE IF EXISTS users;

-- 1. 사용자 테이블
CREATE TABLE users (
    user_id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    PASSWORD VARCHAR(255) NOT NULL,
    NAME VARCHAR(50) NOT NULL,
    ROLE VARCHAR(20) NOT NULL DEFAULT 'worker',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 2. 작업 구역 테이블
CREATE TABLE zones (
    zone_id INT AUTO_INCREMENT PRIMARY KEY,
    zone_name VARCHAR(100) NOT NULL UNIQUE,
    qr_code_value VARCHAR(255) NOT NULL UNIQUE,
    description VARCHAR(255),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 3. 위험 기록 테이블
CREATE TABLE risks (
    risk_id INT AUTO_INCREMENT PRIMARY KEY,
    zone_id INT NOT NULL,
    user_id INT NOT NULL,
    title VARCHAR(100) NOT NULL,
    description TEXT,
    image_path VARCHAR(255),
    risk_level TINYINT NOT NULL,
    status ENUM('미조치','조치중','완료') NOT NULL DEFAULT '미조치',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    CONSTRAINT chk_risk_level
        CHECK (risk_level BETWEEN 1 AND 5),

    CONSTRAINT fk_risks_zone
        FOREIGN KEY (zone_id) REFERENCES zones(zone_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_risks_user
        FOREIGN KEY (user_id) REFERENCES users(user_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- 4. AI 분석 결과 테이블
CREATE TABLE risk_analysis (
    analysis_id INT AUTO_INCREMENT PRIMARY KEY,
    risk_id INT NOT NULL UNIQUE,
    detected_objects TEXT,
    risk_type VARCHAR(100) NOT NULL,
    law_result TEXT,
    action_guide TEXT,
    analysis_summary TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_analysis_risk
        FOREIGN KEY (risk_id) REFERENCES risks(risk_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- 5. 인수인계 보고서 테이블
CREATE TABLE handover_reports (
    report_id INT AUTO_INCREMENT PRIMARY KEY,
    zone_id INT NOT NULL,
    report_date DATE NOT NULL,
    shift_type ENUM('주간','야간') NOT NULL,
    summary_text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_reports_zone
        FOREIGN KEY (zone_id) REFERENCES zones(zone_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- 6. 보고서와 위험 기록 연결 테이블
CREATE TABLE report_risks (
    report_risk_id INT AUTO_INCREMENT PRIMARY KEY,
    report_id INT NOT NULL,
    risk_id INT NOT NULL,

    CONSTRAINT uq_report_risk UNIQUE (report_id, risk_id),

    CONSTRAINT fk_report_risks_report
        FOREIGN KEY (report_id) REFERENCES handover_reports(report_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE,

    CONSTRAINT fk_report_risks_risk
        FOREIGN KEY (risk_id) REFERENCES risks(risk_id)
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- View
CREATE VIEW zone_risk_stats AS
SELECT
    z.zone_id,
    z.zone_name,
    COUNT(r.risk_id) AS total_risk_count,
    SUM(CASE WHEN r.status = '미조치' THEN 1 ELSE 0 END) AS unresolved_count,
    SUM(CASE WHEN r.risk_level >= 4 THEN 1 ELSE 0 END) AS high_risk_count,
    ROUND(AVG(r.risk_level), 2) AS avg_risk_level
FROM zones z
LEFT JOIN risks r
    ON z.zone_id = r.zone_id
GROUP BY z.zone_id, z.zone_name;

CREATE INDEX idx_risks_zone_id ON risks(zone_id);
CREATE INDEX idx_risks_user_id ON risks(user_id);
CREATE INDEX idx_risks_status ON risks(status);
CREATE INDEX idx_risks_created_at ON risks(created_at);

CREATE INDEX idx_handover_zone_date 
ON handover_reports(zone_id, report_date);

SHOW TABLES;
SHOW FULL TABLES WHERE TABLE_TYPE = 'VIEW';