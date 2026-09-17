// middleware/auth.js
const jwt = require("jsonwebtoken");

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), username: user.username }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET); // 만료/위조 시 throw
}

// REST API 보호용 (필요한 라우트에서만 사용)
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "토큰이 필요합니다." });

  try {
    const payload = verifyToken(token);
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: "유효하지 않은 토큰입니다." });
  }
}

// Socket.io 연결 시 인증 미들웨어
function socketAuthMiddleware(socket, next) {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error("인증 토큰이 없습니다."));

  try {
    const payload = verifyToken(token);
    socket.user = { _id: payload.sub, username: payload.username };
    next();
  } catch (err) {
    next(new Error("유효하지 않은 토큰입니다."));
  }
}

module.exports = { signToken, verifyToken, requireAuth, socketAuthMiddleware };
