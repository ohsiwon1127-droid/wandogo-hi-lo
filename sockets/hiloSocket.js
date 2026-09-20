// sockets/hiloSocket.js
const HiloRound = require("../models/HiloRound");
const User = require("../models/User");
const { drawCard, getOdds, resolveGuess } = require("../services/hiloEngine");

function registerHiloHandlers(io, socket) {
  const userId = socket.user._id; // socketAuthMiddleware에서 이미 검증/주입됨

  socket.on("hilo:start", async ({ betAmount }, ack) => {
    try {
      if (!Number.isFinite(betAmount) || betAmount <= 0) {
        return ack?.({ ok: false, error: "베팅 금액이 올바르지 않습니다." });
      }

      const existing = await HiloRound.findOne({ userId, status: "active" });
      if (existing) {
        return ack?.({ ok: false, error: "이미 진행 중인 라운드가 있습니다.", roundId: existing._id });
      }

      const user = await User.findOneAndUpdate(
        { _id: userId, balance: { $gte: betAmount } },
        { $inc: { balance: -betAmount } },
        { new: true }
      );
      if (!user) return ack?.({ ok: false, error: "잔액이 부족합니다." });

      const firstCard = drawCard();
      const round = await HiloRound.create({
        userId,
        betAmount,
        currentCard: firstCard,
        multiplier: 1,
        history: [],
        status: "active",
      });

      ack?.({
        ok: true,
        roundId: round._id,
        card: firstCard,
        multiplier: round.multiplier,
        balance: user.balance,
        odds: getOdds(firstCard.value),
      });
    } catch (err) {
      console.error("[hilo:start] error", err);
      ack?.({ ok: false, error: "서버 오류가 발생했습니다." });
    }
  });

  socket.on("hilo:guess", async ({ roundId, direction }, ack) => {
    try {
      if (!["higher", "lower"].includes(direction)) {
        return ack?.({ ok: false, error: "direction은 'higher' 또는 'lower' 여야 합니다." });
      }

      const round = await HiloRound.findOne({ _id: roundId, userId, status: "active" });
      if (!round) return ack?.({ ok: false, error: "진행 중인 라운드를 찾을 수 없습니다." });

      const oddsBefore = getOdds(round.currentCard.value);
      const chosenOdds = oddsBefore[direction];
      if (!chosenOdds || chosenOdds.multiplier === null) {
        return ack?.({ ok: false, error: "현재 카드에서는 해당 방향을 선택할 수 없습니다." });
      }

      const { win, drawnCard, tie } = resolveGuess(round.currentCard.value, direction);

      // 동점(push): 승패 없음, 배수 변화 없이 카드만 갱신하고 재도전
      if (win === null) {
        round.currentCard = drawnCard;
        round.history.push({
          card: drawnCard,
          direction,
          result: "push",
          multiplierAfter: round.multiplier,
        });
        await round.save();

        return ack?.({
          ok: true,
          result: "push",
          tie: true,
          drawnCard,
          multiplier: round.multiplier,
          nextOdds: getOdds(drawnCard.value),
        });
      }

      if (win === false) {
        round.status = "lost";
        round.currentCard = drawnCard;
        round.history.push({ card: drawnCard, direction, result: "lose", multiplierAfter: 0 });
        await round.save();
        return ack?.({ ok: true, result: "lose", tie, drawnCard, multiplier: 0 });
      }

      const newMultiplier = +(round.multiplier * chosenOdds.multiplier).toFixed(2);
      round.multiplier = newMultiplier;
      round.currentCard = drawnCard;
      round.history.push({ card: drawnCard, direction, result: "win", multiplierAfter: newMultiplier });
      await round.save();

      ack?.({
        ok: true,
        result: "win",
        drawnCard,
        multiplier: newMultiplier,
        potentialPayout: +(round.betAmount * newMultiplier).toFixed(2),
        nextOdds: getOdds(drawnCard.value),
      });
    } catch (err) {
      console.error("[hilo:guess] error", err);
      ack?.({ ok: false, error: "서버 오류가 발생했습니다." });
    }
  });

  socket.on("hilo:cashout", async ({ roundId }, ack) => {
    try {
      const round = await HiloRound.findOne({ _id: roundId, userId, status: "active" });
      if (!round) return ack?.({ ok: false, error: "진행 중인 라운드를 찾을 수 없습니다." });

      const payout = +(round.betAmount * round.multiplier).toFixed(2);

      const user = await User.findOneAndUpdate({ _id: userId }, { $inc: { balance: payout } }, { new: true });

      round.status = "cashed_out";
      round.payout = payout;
      await round.save();

      ack?.({ ok: true, payout, balance: user.balance });
    } catch (err) {
      console.error("[hilo:cashout] error", err);
      ack?.({ ok: false, error: "서버 오류가 발생했습니다." });
    }
  });
}

module.exports = { registerHiloHandlers };
