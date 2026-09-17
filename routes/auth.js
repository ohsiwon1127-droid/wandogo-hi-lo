// routes/auth.js
const express = require("express");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { signToken } = require("../middleware/auth");

const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password || password.length < 6) {
      return res.status(400).json({ error: "아이디/비밀번호를 확인하세요 (비밀번호 6자 이상)." });
    }

    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ error: "이미 존재하는 아이디입니다." });

    const passwordHash = await bcrypt.hash(password, 10);
    const startingBalance = Number(process.env.STARTING_BALANCE || 10000);

    const user = await User.create({ username, passwordHash, balance: startingBalance });
    const token = signToken(user);

    res.json({ ok: true, token, user: { username: user.username, balance: user.balance } });
  } catch (err) {
    console.error("[register] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: "아이디 또는 비밀번호가 틀렸습니다." });

    const token = signToken(user);
    res.json({ ok: true, token, user: { username: user.username, balance: user.balance } });
  } catch (err) {
    console.error("[login] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
