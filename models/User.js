// models/User.js
const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    username: { type: String, required: true, unique: true, trim: true, minlength: 3, maxlength: 20 },
    passwordHash: { type: String, required: true },

    // 가입 시 잔액 0원 (가입금 없음). 이후 관리자가 충전/차감.
    balance: { type: Number, required: true, default: 0, min: 0 },

    // 가입하면 일단 대기 상태. 관리자가 승인해야 로그인/플레이 가능.
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    role: { type: String, enum: ["user", "admin"], default: "user", index: true },
  },
  { timestamps: true }
);

module.exports = mongoose.models.User || mongoose.model("User", userSchema);
