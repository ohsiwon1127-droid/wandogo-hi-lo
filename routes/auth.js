// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { signToken, requireAuth } = require("../middleware/auth");

const router = express.Router();

// 회원가입: 승인 대기 상태로 생성, 잔액 0원, 토큰 발급 안 함(승인 전엔 로그인 불가)
router.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || typeof username !== "string" || username.trim().length < 3) {
      return res.status(400).json({ error: "아이디는 3자 이상이어야 합니다." });
    }
    if (!password || password.length < 6) {
      return res.status(400).json({ error: "비밀번호는 6자 이상이어야 합니다." });
    }

    const exists = await User.findOne({ username: username.trim() });
    if (exists) return res.status(409).json({ error: "이미 존재하는 아이디입니다." });

    const passwordHash = await bcrypt.hash(password, 10);
    await User.create({
      username: username.trim(),
      passwordHash,
      balance: 0,
      status: "pending",
      role: "user",
    });

    res.json({
      ok: true,
      message: "가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있습니다.",
    });
  } catch (err) {
    console.error("[register] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username: (username || "").trim() });
    if (!user) return res.status(401).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });

    if (user.status === "pending") {
      return res.status(403).json({ error: "관리자 승인 대기중입니다.", status: "pending" });
    }
    if (user.status === "rejected") {
      return res.status(403).json({ error: "가입이 거절된 계정입니다.", status: "rejected" });
    }

    const token = signToken(user);
    res.json({
      ok: true,
      token,
      user: { username: user.username, balance: user.balance, role: user.role },
    });
  } catch (err) {
    console.error("[login] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 로그인한 유저가 자기 잔액 등 최신 정보를 다시 확인할 때 사용 (새로고침 후 등)
router.get("/me", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    if (user.status !== "approved") {
      return res.status(403).json({ error: "승인되지 않은 계정입니다.", status: user.status });
    }
    res.json({ ok: true, user: { username: user.username, balance: user.balance, role: user.role } });
  } catch (err) {
    console.error("[me] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
