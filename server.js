const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  if (req.path === "/") {
    return res.redirect("/login.html");
  }
  next();
});

app.use(express.static("public"));
app.use("/uploads", express.static("uploads"));
app.use("/frames", express.static("frames"));

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("frames")) fs.mkdirSync("frames");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

app.post("/login", (req, res) => {
  const id = req.body.userid;
  const pw = req.body.pwd;

  if (id === "admin" && pw === "1234") {
    return res.redirect("/index.html");
  }

  res.send("아이디 또는 비밀번호 틀림");
});

app.post("/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.send("파일 없음");
  }

  const videoPath = req.file.path;
  const videoName = path.parse(req.file.filename).name;

  exec(`python3 frame_extractor.py "${videoPath}"`, (err, stdout, stderr) => {
    if (err) {
      console.log(stderr);
      return res.send("python 실행 오류: " + stderr);
    }

    res.send(`
      <h2>등록 완료</h2>
      <a href="/frames/${videoName}/frame_0.jpg">프레임 보기</a>
      <br><br>
      <a href="/index.html">돌아가기</a>
    `);
  });
});

app.listen(PORT, () => {
  console.log("server running on port " + PORT);
});
