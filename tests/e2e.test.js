// tests/e2e.test.js
process.env.JWT_SECRET = "test_secret_key_for_e2e";
process.env.PORT = "3999";
process.env.MONGODB_URI = "mongodb://fake-for-test/hilo";
process.env.ADMIN_USERNAME = "admin";
process.env.ADMIN_PASSWORD = "admin_password_123";
process.env.ADMIN_SIGNUP_CODE = "secret_admin_code_456";

const path = require("path");
const { FakeCollection } = require("./fakeCollection");

const mongoosePath = require.resolve("mongoose");
require.cache[mongoosePath] = {
  id: mongoosePath,
  filename: mongoosePath,
  loaded: true,
  exports: {
    connect: async () => {},
    connection: { readyState: 1 },
    Schema: class {},
    models: {},
    model: () => ({}),
  },
};
require.cache[mongoosePath].exports.Schema.Types = { ObjectId: "ObjectId" };

const userCollection = new FakeCollection();
const roundCollection = new FakeCollection();
const balanceLogCollection = new FakeCollection();

function patchModule(relativePath, exportsValue) {
  const abs = path.resolve(__dirname, relativePath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsValue };
}
patchModule("../models/User.js", userCollection);
patchModule("../models/HiloRound.js", roundCollection);
patchModule("../models/BalanceLog.js", balanceLogCollection);

async function main() {
  require("../server.js");
  await new Promise((r) => setTimeout(r, 800));

  const base = "http://localhost:3999";

  async function post(p, body, token) {
    const res = await fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
      body: JSON.stringify(body || {}),
    });
    return { status: res.status, data: await res.json() };
  }
  async function get(p, token) {
    const res = await fetch(base + p, { headers: token ? { Authorization: "Bearer " + token } : {} });
    return { status: res.status, data: await res.json() };
  }

  // ---- 0) 부트스트랩 관리자 로그인 ----
  let r = await post("/api/auth/login", { username: "admin", password: "admin_password_123" });
  console.log("[부트스트랩 관리자 로그인]", r.status, r.data.ok);
  if (!r.data.ok) throw new Error("부트스트랩 관리자 로그인 실패");
  const bootAdminToken = r.data.token;

  // ---- 1) 일반 회원가입 (승인 대기) ----
  const username = "player_" + Date.now();
  r = await post("/api/auth/register", { username, password: "playerpass1" });
  console.log("[일반 회원가입]", r.status, r.data);
  if (!r.data.ok) throw new Error("회원가입 실패");

  r = await post("/api/auth/login", { username, password: "playerpass1" });
  console.log("[승인 전 로그인]", r.status, r.data);
  if (r.data.ok || r.data.status !== "pending") throw new Error("버그: 승인 전 로그인 차단 실패");

  // ---- 2) 관리자 코드로 가입 -> 즉시 승인+관리자 ----
  const codeAdminUsername = "codeadmin_" + Date.now();
  r = await post("/api/auth/register", { username: codeAdminUsername, password: "codeadminpass1", adminCode: "secret_admin_code_456" });
  console.log("[관리자 코드로 가입]", r.status, r.data);
  if (!r.data.ok) throw new Error("관리자 코드 가입 실패");

  r = await post("/api/auth/login", { username: codeAdminUsername, password: "codeadminpass1" });
  console.log("[관리자 코드 가입 계정 로그인]", r.status, r.data.ok, r.data.user);
  if (!r.data.ok) throw new Error("버그: 관리자 코드로 가입한 계정이 바로 로그인 안 됨(즉시 승인 실패)");
  if (r.data.user.role !== "admin") throw new Error("버그: 관리자 코드로 가입했는데 role이 admin이 아님");
  const codeAdminToken = r.data.token;

  // 틀린 코드로는 관리자가 되면 안 됨
  const wrongCodeUsername = "wrongcode_" + Date.now();
  r = await post("/api/auth/register", { username: wrongCodeUsername, password: "whatever1", adminCode: "완전히_틀린_코드" });
  r = await get("/api/admin/users", bootAdminToken);
  const wrongCodeUser = r.data.users.find((u) => u.username === wrongCodeUsername);
  console.log("[틀린 코드로 가입한 유저 상태]", wrongCodeUser.status, "isAdmin=", wrongCodeUser.isAdmin);
  if (wrongCodeUser.isAdmin || wrongCodeUser.status !== "pending") throw new Error("버그: 틀린 관리자 코드인데 관리자/승인됨으로 처리됨");

  // ---- 3) 관리자가 대기 유저 승인 (username 기반) ----
  r = await post("/api/admin/approve", { username }, bootAdminToken);
  console.log("[승인]", r.status, r.data);
  if (!r.data.ok || r.data.status !== "approved") throw new Error("승인 실패");

  r = await post("/api/auth/login", { username, password: "playerpass1" });
  if (!r.data.ok) throw new Error("승인 후 로그인 실패");
  const playerToken = r.data.token;

  // 일반 유저는 admin API 접근 불가
  r = await get("/api/admin/users", playerToken);
  console.log("[일반 유저의 admin API 접근]", r.status);
  if (r.status !== 403) throw new Error("버그: 일반 유저가 admin API 접근 가능");

  // ---- 4) 관리자(부트스트랩 admin) 본인 계정도 충전 가능해야 함 (핵심 버그 수정 확인) ----
  r = await post("/api/admin/recharge", { username: "admin", amount: 3000 }, bootAdminToken);
  console.log("[관리자 자신에게 충전]", r.status, r.data);
  if (!r.data.ok || r.data.balance !== 3000) throw new Error("버그: 관리자 계정 충전이 안 됨");

  // 코드로 가입한 다른 관리자 계정도 충전 가능해야 함
  r = await post("/api/admin/recharge", { username: codeAdminUsername, amount: 2000 }, bootAdminToken);
  console.log("[다른 관리자 계정에게 충전]", r.status, r.data);
  if (!r.data.ok || r.data.balance !== 2000) throw new Error("버그: 다른 관리자 계정 충전이 안 됨");

  // 일반 유저는 충전 API 호출 불가
  r = await post("/api/admin/recharge", { username, amount: 999999 }, playerToken);
  console.log("[일반 유저의 충전 시도]", r.status);
  if (r.status !== 403) throw new Error("버그: 일반 유저가 충전 API 호출 가능");

  // ---- 5) 관리자 본인 계정으로 실제 게임 플레이 (충전된 잔액으로) ----
  const { io } = require("socket.io-client");
  const adminSocket = io(base, { auth: { token: bootAdminToken } });
  await new Promise((resolve, reject) => {
    adminSocket.on("connect", resolve);
    adminSocket.on("connect_error", reject);
  });

  let startRes = await new Promise((resolve) => adminSocket.emit("hilo:start", { betAmount: 500 }, resolve));
  console.log("[관리자 플레이 - 시작]", startRes.ok, startRes.card);
  if (!startRes.ok) throw new Error("버그: 관리자가 게임을 시작할 수 없음");

  // 카드에 실제 무늬 기호가 있는지 확인 (알파벳 코드가 아니라 ♠♥♦♣ 중 하나)
  const validSuits = ["♠", "♥", "♦", "♣"];
  if (!validSuits.includes(startRes.card.suit)) {
    throw new Error("버그: 카드 무늬가 기호가 아님 (실제 값: " + startRes.card.suit + ")");
  }
  if (!["red", "black"].includes(startRes.card.color)) {
    throw new Error("버그: 카드 색상 정보가 없음");
  }
  const expectedColor = (startRes.card.suit === "♥" || startRes.card.suit === "♦") ? "red" : "black";
  if (startRes.card.color !== expectedColor) throw new Error("버그: 카드 색상이 무늬와 안 맞음");
  console.log("[카드 무늬/색상 확인]", startRes.card.suit, startRes.card.color, "정상");

  const roundId = startRes.roundId;
  const direction = startRes.card.value >= 8 ? "lower" : "higher";
  const guessRes = await new Promise((resolve) => adminSocket.emit("hilo:guess", { roundId, direction }, resolve));
  console.log("[관리자 플레이 - 예측]", guessRes.result, guessRes.drawnCard);
  if (!["win", "lose", "push"].includes(guessRes.result)) throw new Error("예측 결과 이상함");
  if (guessRes.drawnCard && !validSuits.includes(guessRes.drawnCard.suit)) {
    throw new Error("버그: 드로우된 카드 무늬가 기호가 아님");
  }

  const cashoutRes = await new Promise((resolve) => adminSocket.emit("hilo:cashout", { roundId }, resolve));
  console.log("[관리자 플레이 - 캐시아웃]", cashoutRes);
  if (!cashoutRes.ok) throw new Error("관리자 캐시아웃 실패");
  adminSocket.close();

  // ---- 6) 거절(=삭제) 플로우 ----
  const rejUsername = "rejected_" + Date.now();
  await post("/api/auth/register", { username: rejUsername, password: "rejectme1" });
  r = await post("/api/admin/reject", { username: rejUsername }, bootAdminToken);
  console.log("[거절/삭제]", r.status, r.data);
  if (!r.data.ok) throw new Error("거절(삭제) 실패");

  r = await post("/api/auth/login", { username: rejUsername, password: "rejectme1" });
  console.log("[삭제된 계정으로 로그인 시도]", r.status, r.data);
  if (r.data.ok) throw new Error("버그: 삭제된 계정으로 로그인 성공함");

  r = await get("/api/admin/users", bootAdminToken);
  if (r.data.users.find((u) => u.username === rejUsername)) throw new Error("버그: 거절된 유저가 목록에서 삭제되지 않음");

  // 관리자가 자기 자신은 삭제 못 하게 막혀야 함
  r = await post("/api/admin/reject", { username: "admin" }, bootAdminToken);
  console.log("[관리자 자기자신 삭제 시도]", r.status, r.data);
  if (r.data.ok) throw new Error("버그: 관리자가 자기 자신을 삭제할 수 있음");

  console.log("\n✅ 전체 E2E 테스트 통과 (관리자코드 가입, 승인, 관리자 본인 충전/플레이, 거절=삭제, 카드 무늬/색상 모두 확인)");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ 테스트 실패:", err);
  process.exit(1);
});
