// middleware/auth.js
const jwt = require("jsonwebtoken");
const User = require("../models/User");

function signToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET); // 만료/위조 시 throw
}

function getBearerToken(req) {
  const header = req.headers.authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : null;
}

// REST API 보호용: 로그인 여부만 확인 (req.userId만 세팅)
function requireAuth(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "토큰이 필요합니다." });

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: "유효하지 않은 토큰입니다." });
  }
}

// 관리자 전용 라우트 보호용.
// role은 JWT에도 있지만, 승인 취소/강등이 즉시 반영되도록 DB에서 다시 확인한다.
async function requireAdmin(req, res, next) {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: "토큰이 필요합니다." });

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user || user.role !== "admin" || user.status !== "approved") {
      return res.status(403).json({ error: "관리자 권한이 없습니다." });
    }
    req.userId = user._id.toString();
    req.adminUser = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: "유효하지 않은 토큰입니다." });
  }
}

// Socket.io 연결 시 인증 미들웨어.
// 승인(approved) 상태가 아니면 게임 서버에 연결조차 못 하게 막는다.
async function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("인증 토큰이 없습니다."));

  try {
    const payload = verifyToken(token);
    const user = await User.findById(payload.sub);
    if (!user) return next(new Error("존재하지 않는 사용자입니다."));
    if (user.status !== "approved") return next(new Error("관리자 승인 대기중이거나 거절된 계정입니다."));

    socket.user = { _id: user._id.toString(), username: user.username, role: user.role };
    next();
  } catch (err) {
    next(new Error("유효하지 않은 토큰입니다."));
  }
}

module.exports = { signToken, verifyToken, requireAuth, requireAdmin, socketAuthMiddleware };
