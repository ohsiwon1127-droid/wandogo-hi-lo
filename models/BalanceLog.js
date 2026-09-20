// models/BalanceLog.js
const mongoose = require("mongoose");

const balanceLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    amount: { type: Number, required: true }, // 양수=충전, 음수=차감
    balanceAfter: { type: Number, required: true },
    reason: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.BalanceLog || mongoose.model("BalanceLog", balanceLogSchema);
