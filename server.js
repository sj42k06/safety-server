const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { exec } = require("child_process");

const app = express();
const PORT = process.env.PORT || 3000;

if (!fs.existsSync("uploads")) fs.mkdirSync("uploads");
if (!fs.existsSync("uploads/videos")) fs.mkdirSync("uploads/videos", { recursive: true });
if (!fs.existsSync("frames")) fs.mkdirSync("frames");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, "public")));
app.use("/uploads", express.static("uploads"));
app.use("/frames", express.static("frames"));

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.mimetype.startsWith("video")) cb(null, "uploads/videos/");
    else cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + ext);
  }
});

const upload = multer({ storage });

app.post("/upload", upload.fields([
  { name: "videos", maxCount: 10 },
  { name: "images", maxCount: 10 }
]), (req, res) => {

  const videoFiles = req.files["videos"] || [];

  videoFiles.forEach(file => {
    const videoPath = file.path;

    exec(`python frame_extractor.py ${videoPath}`, (err, stdout, stderr) => {
      if (err) {
        console.error(err);
      } else {
        console.log(stdout);
      }
    });
  });

  res.send("OK");
});

app.listen(PORT, () => {
  console.log(`server running on port ${PORT}`);
});
