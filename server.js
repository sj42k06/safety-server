const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

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

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname))
});

const upload = multer({ storage });

app.post("/login", (req, res) => {
  const { userid, pwd } = req.body;
  if (userid === "admin" && pwd === "1234") {
    return res.redirect("/index.html");
  }
  res.send("아이디 또는 비밀번호 틀림");
});

app.post("/upload", upload.single("image"), async (req, res) => {
  if (!req.file) return res.send("파일 없음");

  try {
    const form = new FormData();
    form.append("file", fs.createReadStream(req.file.path));

    const response = await axios.post(
      "https://web-production-ab3b.up.railway.app/process",
      form,
      { headers: form.getHeaders() }
    );

    res.send(`
      <h2>등록 완료</h2>
      <p>${response.data.message}</p>
      <img src="https://web-production-ab3b.up.railway.app/${response.data.frame}" width="300"/>
      <br><br>
      <a href="/index.html">돌아가기</a>
    `);

  } catch (err) {
    console.log(err.response?.data || err.message);
    res.send("서버 오류");
  }
});

app.listen(PORT, () => {
  console.log("server running on port " + PORT);
});
