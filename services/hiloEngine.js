// services/hiloEngine.js
// 하이로(Hilo) 게임 코어 로직.
// 설계 방침: "매 판 새로 섞이므로 카드 세기가 무의미하다"는 규칙에 맞춰,
// 덱을 소모(차감)하며 추적하지 않고 매 드로우마다 표준 52장 분포에서
// 독립적으로 확률/배당을 계산한다 (Stake 원본 방식과 동일한 접근).

const crypto = require("crypto");

// 카드 값: 2~10, J=11, Q=12, K=13, A=14 (A를 최고로 취급)
const MIN_VALUE = 2;
const MAX_VALUE = 14;
const SUITS = ["S", "H", "D", "C"]; // 스페이드, 하트, 다이아, 클럽
const RANK_LABEL = {
  2: "2", 3: "3", 4: "4", 5: "5", 6: "6", 7: "7", 8: "8", 9: "9", 10: "10",
  11: "J", 12: "Q", 13: "K", 14: "A",
};

const DEFAULT_HOUSE_EDGE = 0.01; // 1%
const TIE_RULE = "loss"; // 'loss' | 'push' — 동점 처리 방식. 필요시 변경.

/**
 * 암호학적으로 안전한 난수로 카드 한 장을 뽑는다.
 * 52장 중 균등 분포 (rank 13종 x suit 4종).
 */
function drawCard() {
  const idx = crypto.randomInt(0, 52); // 0~51
  const rankIndex = idx % 13; // 0~12
  const suitIndex = Math.floor(idx / 13); // 0~3
  const value = rankIndex + 2; // 2~14
  return {
    value,
    rank: RANK_LABEL[value],
    suit: SUITS[suitIndex],
  };
}

/**
 * 현재 카드 값 기준으로 다음 카드가 높음/낮음/동점일 장수를 센다.
 * 표준 52장 기준 (rank당 4장).
 */
function countRelations(currentValue) {
  let higher = 0;
  let lower = 0;
  let tie = 0;
  for (let v = MIN_VALUE; v <= MAX_VALUE; v++) {
    if (v > currentValue) higher += 4;
    else if (v < currentValue) lower += 4;
    else tie += 4;
  }
  return { higher, lower, tie, total: 52 };
}

/**
 * 특정 방향 적중 확률에 대한 배당 배수 계산.
 * multiplier = (1 / 확률) * (1 - 하우스엣지)
 * count가 0이면 (예: 현재 카드가 A=14일 때 '높음') 그 방향은 선택 불가.
 */
function calcMultiplier(favorableCount, total, houseEdge = DEFAULT_HOUSE_EDGE) {
  if (favorableCount <= 0) return null;
  const probability = favorableCount / total;
  const multiplier = (1 / probability) * (1 - houseEdge);
  return Math.round(multiplier * 100) / 100;
}

/**
 * 현재 카드 기준으로 higher/lower 각각의 확률과 배당을 반환.
 * 프론트에 "각 선택 옆에 확률과 배당 표시" 하는 데 그대로 사용.
 */
function getOdds(currentValue, houseEdge = DEFAULT_HOUSE_EDGE) {
  const { higher, lower, tie, total } = countRelations(currentValue);
  return {
    higher: {
      count: higher,
      probability: +(higher / total).toFixed(4),
      multiplier: calcMultiplier(higher, total, houseEdge),
    },
    lower: {
      count: lower,
      probability: +(lower / total).toFixed(4),
      multiplier: calcMultiplier(lower, total, houseEdge),
    },
    tie: {
      count: tie,
      probability: +(tie / total).toFixed(4),
    },
  };
}

/**
 * 한 번의 예측(guess)을 판정.
 * direction: 'higher' | 'lower'
 * 반환: { win, drawnCard, tie }
 */
function resolveGuess(currentValue, direction) {
  const drawn = drawCard();
  const isTie = drawn.value === currentValue;

  let win;
  if (isTie) {
    // TIE_RULE === 'loss' -> 동점은 무조건 실패 처리
    // TIE_RULE === 'push' -> 필요시 별도 재드로우 로직으로 확장
    win = TIE_RULE === "push" ? null : false;
  } else if (direction === "higher") {
    win = drawn.value > currentValue;
  } else {
    win = drawn.value < currentValue;
  }

  return { win, drawnCard: drawn, tie: isTie };
}

module.exports = {
  MIN_VALUE,
  MAX_VALUE,
  drawCard,
  countRelations,
  calcMultiplier,
  getOdds,
  resolveGuess,
  DEFAULT_HOUSE_EDGE,
};
