// server.js
require("dotenv").config();

const express = require("express");
const http = require("http");
const cors = require("cors");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

const authRoutes = require("./routes/auth");
const { socketAuthMiddleware } = require("./middleware/auth");
const { registerHiloHandlers } = require("./sockets/hiloSocket");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public")); // public/index.html 등 정적 파일 제공

app.use("/api/auth", authRoutes);

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

async function start() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log("[db] MongoDB 연결 성공");

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
