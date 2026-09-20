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
// 동점(Tie) 규칙: 'push' — 승패 처리 없이 배수 변화 없이 그대로 넘어감(재도전).
// 이렇게 해야 높음+낮음 확률의 합이 정확히 100%가 되어 배당이 부풀려지지 않음.
const TIE_RULE = "push";

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
  const total = 52;
  const effectiveTotal = total - tie; // 동점(push)을 제외한, 승패가 갈리는 카드 수
  return { higher, lower, tie, total, effectiveTotal };
}

/**
 * 특정 방향 적중 확률에 대한 배당 배수 계산.
 * multiplier = (1 / 확률) * (1 - 하우스엣지)
 * 동점은 push(무효 처리)이므로, 확률의 분모는 동점을 뺀 '승패가 갈리는 카드 수'를 쓴다.
 * 그래야 높음+낮음 확률의 합이 정확히 100%가 되어 배당이 부풀려지지 않는다.
 * count가 0이면 (예: 현재 카드가 A=14일 때 '높음') 그 방향은 선택 불가.
 */
const MIN_MULTIPLIER = 1.01; // 승리 시 원금보다 적게 받는 일이 없도록 하는 하한선

function calcMultiplier(favorableCount, effectiveTotal, houseEdge = DEFAULT_HOUSE_EDGE) {
  if (favorableCount <= 0) return null;
  const probability = favorableCount / effectiveTotal;
  const multiplier = (1 / probability) * (1 - houseEdge);
  // 극단 카드(2 또는 A)처럼 승리 확률이 100%에 가까우면 하우스엣지 적용 시
  // 배당이 1 밑으로 떨어질 수 있음 (승리했는데 원금보다 적게 받는 모순) -> 하한 보정
  return Math.max(MIN_MULTIPLIER, Math.round(multiplier * 100) / 100);
}

/**
 * 현재 카드 기준으로 higher/lower 각각의 확률과 배당을 반환.
 * 프론트에 "각 선택 옆에 확률과 배당 표시" 하는 데 그대로 사용.
 */
function getOdds(currentValue, houseEdge = DEFAULT_HOUSE_EDGE) {
  const { higher, lower, tie, total, effectiveTotal } = countRelations(currentValue);
  return {
    higher: {
      count: higher,
      probability: effectiveTotal > 0 ? +(higher / effectiveTotal).toFixed(4) : 0,
      multiplier: calcMultiplier(higher, effectiveTotal, houseEdge),
    },
    lower: {
      count: lower,
      probability: effectiveTotal > 0 ? +(lower / effectiveTotal).toFixed(4) : 0,
      multiplier: calcMultiplier(lower, effectiveTotal, houseEdge),
    },
    tie: {
      count: tie,
      probability: +(tie / total).toFixed(4), // 참고용: 다음 드로우가 동점(push)일 확률
    },
  };
}

/**
 * 한 번의 예측(guess)을 판정.
 * direction: 'higher' | 'lower'
 * 반환: { win, drawnCard, tie }
 *   win === true  -> 적중 (배수 상승)
 *   win === false -> 실패 (라운드 종료)
 *   win === null  -> 동점(push): 승패 없음, 배수 변화 없이 그대로 다시 예측
 */
function resolveGuess(currentValue, direction) {
  const drawn = drawCard();
  const isTie = drawn.value === currentValue;

  let win;
  if (isTie) {
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
