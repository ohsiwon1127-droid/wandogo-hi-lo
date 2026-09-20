// routes/admin.js
const express = require("express");
const User = require("../models/User");
const HiloRound = require("../models/HiloRound");
const BalanceLog = require("../models/BalanceLog");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// 이 라우터의 모든 엔드포인트는 관리자만 접근 가능
router.use(requireAdmin);

// 전체 유저 목록 (대기중인 유저가 먼저 보이도록 정렬)
router.get("/users", async (req, res) => {
  try {
    const users = await User.find({}, "-passwordHash").sort({ status: 1, createdAt: -1 });
    res.json({ ok: true, users });
  } catch (err) {
    console.error("[admin:users] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 승인
router.post("/users/:id/approve", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: "approved" }, { new: true });
    if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ ok: true, user: { _id: user._id, username: user.username, status: user.status } });
  } catch (err) {
    console.error("[admin:approve] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 거절
router.post("/users/:id/reject", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: "rejected" }, { new: true });
    if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ ok: true, user: { _id: user._id, username: user.username, status: user.status } });
  } catch (err) {
    console.error("[admin:reject] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 승인 취소 (다시 대기 상태로)
router.post("/users/:id/revoke", async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, { status: "pending" }, { new: true });
    if (!user) return res.status(404).json({ error: "사용자를 찾을 수 없습니다." });
    res.json({ ok: true, user: { _id: user._id, username: user.username, status: user.status } });
  } catch (err) {
    console.error("[admin:revoke] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 잔액 충전/차감 (amount는 양수=충전, 음수=차감)
router.post("/users/:id/balance", async (req, res) => {
  try {
    const amount = Number(req.body.amount);
    const reason = (req.body.reason || "").toString().slice(0, 200);

    if (!Number.isFinite(amount) || amount === 0) {
      return res.status(400).json({ error: "amount는 0이 아닌 숫자여야 합니다." });
    }

    // 차감 시 잔액이 음수가 되지 않도록 조건부 원자 업데이트
    const query = { _id: req.params.id };
    if (amount < 0) query.balance = { $gte: -amount };

    const user = await User.findOneAndUpdate(query, { $inc: { balance: amount } }, { new: true });
    if (!user) {
      return res.status(400).json({ error: "사용자를 찾을 수 없거나 잔액이 부족합니다." });
    }

    await BalanceLog.create({
      userId: user._id,
      adminId: req.userId,
      amount,
      balanceAfter: user.balance,
      reason,
    });

    res.json({ ok: true, user: { _id: user._id, username: user.username, balance: user.balance } });
  } catch (err) {
    console.error("[admin:balance] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 특정 유저의 충전/차감 이력
router.get("/users/:id/balance-logs", async (req, res) => {
  try {
    const logs = await BalanceLog.find({ userId: req.params.id }).sort({ createdAt: -1 }).limit(50);
    res.json({ ok: true, logs });
  } catch (err) {
    console.error("[admin:balance-logs] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

// 대시보드 요약 통계
router.get("/stats", async (req, res) => {
  try {
    const [totalUsers, pendingUsers, approvedUsers, balanceAgg, totalRounds, wageredAgg] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ status: "pending" }),
      User.countDocuments({ status: "approved" }),
      User.aggregate([{ $group: { _id: null, sum: { $sum: "$balance" } } }]),
      HiloRound.countDocuments({}),
      HiloRound.aggregate([{ $group: { _id: null, sum: { $sum: "$betAmount" } } }]),
    ]);

    res.json({
      ok: true,
      stats: {
        totalUsers,
        pendingUsers,
        approvedUsers,
        totalBalance: balanceAgg[0]?.sum || 0,
        totalRounds,
        totalWagered: wageredAgg[0]?.sum || 0,
      },
    });
  } catch (err) {
    console.error("[admin:stats] error", err);
    res.status(500).json({ error: "서버 오류가 발생했습니다." });
  }
});

module.exports = router;
