const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const mysql = require("mysql2");

const app = express();
const PORT = 5000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));

const db = mysql.createConnection({
host: "localhost",
user: "root",
password: "1234",
database: "safety_system"
});

db.connect((err) => {
if (err) {
console.log("DB 연결 실패", err);
} else {
console.log("DB 연결 성공");
}
});

const storage = multer.diskStorage({
destination: function (req, file, cb) {
cb(null, "uploads/");
},
filename: function (req, file, cb) {
cb(null, Date.now() + "-" + file.originalname);
}
});

const upload = multer({ storage: storage });

app.get("/", (req, res) => {
res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
const { userid, pwd } = req.body;

if (
(userid === "worker01" && pwd === "1234") ||
(userid === "worker02" && pwd === "1234")
) {
res.redirect("/index.html");
} else {
res.send("로그인 실패");
}
});

app.post("/upload", upload.single("image"), (req, res) => {

const description = req.body.description;
const image = req.file ? req.file.filename : null;

const sql = `
INSERT INTO risks
(zone_id,user_id,title,description,image_path,risk_level,status)
VALUES (1,1,?, ?, ?,3,'미조치')
`;

db.query(sql,[description,description,image],(err,result)=>{

if(err){
console.log(err);
res.send("DB 저장 실패");
}else{
res.send("업로드 성공 + DB 저장 완료");
}

});

});

app.listen(PORT, () => {
console.log("server running on port 5000");
});