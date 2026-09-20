// server.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const adminRoutes = require("./routes/admin");
const User = require("./models/User");
const { socketAuthMiddleware } = require("./middleware/auth");
const { registerHiloHandlers } = require("./sockets/hiloSocket");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // public/index.html, admin.html 등 정적 파일 제공

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) => {
  res.json({ ok: true, dbState: mongoose.connection.readyState }); // 1 = connected
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" }, // 배포 시 실제 프론트 도메인으로 제한 권장
});

io.use(socketAuthMiddleware);

io.on("connection", (socket) => {
  console.log(`[socket] connected: ${socket.user.username} (${socket.id})`);

  registerHiloHandlers(io, socket);

  socket.on("disconnect", () => {
    console.log(`[socket] disconnected: ${socket.user.username}`);
  });
});

// 환경변수로 지정한 관리자 계정이 없으면 서버 시작 시 자동 생성.
// 이미 있으면 아무것도 하지 않음 (중복 생성/비밀번호 덮어쓰기 없음).
async function ensureAdminAccount() {
  const { ADMIN_USERNAME, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    console.warn("[admin] ADMIN_USERNAME/ADMIN_PASSWORD가 설정되지 않아 관리자 계정을 자동 생성하지 않습니다.");
    return;
  }

  const existing = await User.findOne({ username: ADMIN_USERNAME });
  if (existing) {
    if (existing.role !== "admin") {
      console.warn(`[admin] '${ADMIN_USERNAME}' 계정이 이미 있지만 admin 권한이 아닙니다. 수동으로 확인해주세요.`);
    }
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  await User.create({
    username: ADMIN_USERNAME,
    passwordHash,
    balance: 0,
    status: "approved",
    role: "admin",
  });
  console.log(`[admin] 관리자 계정 '${ADMIN_USERNAME}' 자동 생성 완료`);
}

async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("[db] MongoDB 연결 성공");

    await ensureAdminAccount();

    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
      console.log(`[server] 실행 중: http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("[db] MongoDB 연결 실패", err);
    process.exit(1);
  }
}

start();
