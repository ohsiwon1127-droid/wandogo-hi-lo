// 하이로(Hi-Lo) 카드 예측 서버 (가상 칩 전용, 실제 결제/환전 없음)
// 구조는 카드 랩 바카라 서버와 동일하게 맞춤: 단일 파일, mongodb 네이티브 드라이버 + 메모리 캐시,
// 같은 API 경로(/api/signup, /api/login, /api/me, /api/admin/*), 같은 승인/충전 방식.
// 게임 로직만 하이로로 교체했고, 하이로는 유저별 개인 라운드라 바카라처럼 전원 동기화된
// 베팅 타이머가 필요 없어서 그 부분은 뺐다 (진행 중인 라운드는 메모리에만 보관).
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const http = require('http');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { MongoClient } = require('mongodb');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
const ADMIN_SIGNUP_CODE = process.env.ADMIN_SIGNUP_CODE || '';
const MONGODB_URI = process.env.MONGODB_URI || '';
const DATA_FILE = path.join(__dirname, 'data', 'users.json');

const START_BALANCE = 0; // 가입 축하 칩 없음 - 관리자 승인/충전 필요
const CHIP = '칩';
const HOUSE_EDGE = 0.01; // 1%
const MIN_MULTIPLIER = 1.01; // 확정승리에 가까운 극단 카드에서 배당이 1 밑으로 떨어지지 않도록 하한

if (!process.env.JWT_SECRET) {
  console.warn('[경고] JWT_SECRET 환경변수가 없어 재시작마다 임시 키를 사용합니다. 배포 시 반드시 지정하세요.');
}
if (!ADMIN_SIGNUP_CODE) {
  console.warn('[경고] ADMIN_SIGNUP_CODE가 없어 관리자 계정을 만들 수 없습니다.');
}
if (!MONGODB_URI) {
  console.warn('[경고] MONGODB_URI가 없어 로컬 파일에 저장합니다. Render 같은 호스팅에서는 재배포/재시작 시 데이터가 사라질 수 있습니다. README를 참고해 무료 DB를 연결하세요.');
}

// ---------- persistence layer (카드 랩과 동일 패턴) ----------
let db = null;
let usersCollection = null;

function fileLoadAll() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); } catch (e) { return {}; }
}
function fileSaveAll() {
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(users, null, 2));
  } catch (e) { console.error('파일 저장 실패:', e.message); }
}

let users = {}; // usernameLower -> { username, passwordHash, balance, isAdmin, status, createdAt }

async function initPersistence() {
  if (MONGODB_URI) {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    db = client.db();
    usersCollection = db.collection('users');
    const docs = await usersCollection.find({}).toArray();
    for (const doc of docs) {
      if (doc._id === '__write_test__') continue;
      users[doc._id] = {
        username: doc.username, passwordHash: doc.passwordHash, balance: doc.balance,
        isAdmin: doc.isAdmin, status: doc.status || 'approved', createdAt: doc.createdAt,
      };
    }
    console.log(`[DB] MongoDB 연결 완료, 실제 사용 db 이름: "${db.databaseName}", 유저 ${docs.length}명 로드`);

    try {
      await usersCollection.updateOne(
        { _id: '__write_test__' },
        { $set: { checkedAt: new Date() } },
        { upsert: true }
      );
      console.log('[DB] 쓰기 권한 테스트 성공 (users 컬렉션에 __write_test__ 문서 기록됨)');
    } catch (e) {
      console.error('[DB] 쓰기 권한 테스트 실패! DB 유저 권한을 확인하세요 ->', e.message);
    }
  } else {
    users = fileLoadAll();
  }
}

async function persistUser(usernameLower) {
  const u = users[usernameLower];
  if (!u) return;
  if (usersCollection) {
    try {
      await usersCollection.updateOne(
        { _id: usernameLower },
        { $set: { username: u.username, passwordHash: u.passwordHash, balance: u.balance, isAdmin: u.isAdmin, status: u.status, createdAt: u.createdAt } },
        { upsert: true }
      );
    } catch (e) {
      console.error(`[DB] 저장 실패: ${usernameLower} ->`, e.message);
    }
  } else {
    fileSaveAll();
  }
}

function findByUsername(username) {
  return users[String(username).toLowerCase()] || null;
}

async function findByUsernameFresh(username) {
  const lower = String(username).toLowerCase();
  if (users[lower]) return users[lower];
  if (usersCollection) {
    const doc = await usersCollection.findOne({ _id: lower });
    if (doc) {
      users[lower] = { username: doc.username, passwordHash: doc.passwordHash, balance: doc.balance, isAdmin: doc.isAdmin, status: doc.status || 'approved', createdAt: doc.createdAt };
      return users[lower];
    }
  }
  return null;
}

function shutdown(signal) {
  console.log(`[${signal}] 종료 신호 수신, 저장 후 종료합니다...`);
  if (!usersCollection) { try { fileSaveAll(); } catch (e) {} }
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// ---------- hilo (하이로) 카드 로직 ----------
const SUITS = [
  { symbol: '♠', color: 'black' },
  { symbol: '♥', color: 'red' },
  { symbol: '♦', color: 'red' },
  { symbol: '♣', color: 'black' },
];
const RANK_LABEL = { 2:'2',3:'3',4:'4',5:'5',6:'6',7:'7',8:'8',9:'9',10:'10',11:'J',12:'Q',13:'K',14:'A' };

function drawCard() {
  const idx = crypto.randomInt(0, 52);
  const value = (idx % 13) + 2;
  const suit = SUITS[Math.floor(idx / 13)];
  return { value, rank: RANK_LABEL[value], suit: suit.symbol, color: suit.color };
}
function countRelations(value) {
  let higher = 0, lower = 0, tie = 0;
  for (let v = 2; v <= 14; v++) {
    if (v > value) higher += 4; else if (v < value) lower += 4; else tie += 4;
  }
  return { higher, lower, tie, effectiveTotal: 52 - tie };
}
function calcMultiplier(favorableCount, effectiveTotal) {
  if (favorableCount <= 0) return null;
  const probability = favorableCount / effectiveTotal;
  const raw = (1 / probability) * (1 - HOUSE_EDGE);
  return Math.max(MIN_MULTIPLIER, Math.round(raw * 100) / 100);
}
function getOdds(value) {
  const { higher, lower, tie, effectiveTotal } = countRelations(value);
  return {
    higher: { probability: effectiveTotal ? +(higher / effectiveTotal).toFixed(4) : 0, multiplier: calcMultiplier(higher, effectiveTotal) },
    lower: { probability: effectiveTotal ? +(lower / effectiveTotal).toFixed(4) : 0, multiplier: calcMultiplier(lower, effectiveTotal) },
    tie: { probability: +(tie / 52).toFixed(4) },
  };
}
// 동점은 push(무효, 배수 변화 없이 재도전). 그래야 높음+낮음 확률 합이 정확히 100%가 되어 배당이 안 부풀려짐.
function resolveGuess(currentValue, direction) {
  const drawn = drawCard();
  if (drawn.value === currentValue) return { win: null, drawnCard: drawn }; // push
  const win = direction === 'higher' ? drawn.value > currentValue : drawn.value < currentValue;
  return { win, drawnCard: drawn };
}

// 유저별 진행 중인 하이로 라운드 (개인 게임이라 DB에 저장 안 하고 메모리에만 유지)
const activeRounds = new Map(); // usernameLower -> { betAmount, multiplier, currentCard }

// ---------- auth helpers (카드 랩과 동일) ----------
const USERNAME_RE = /^[a-zA-Z0-9_]{3,16}$/;

function signToken(user) { return jwt.sign({ u: user.username }, JWT_SECRET, { expiresIn: '30d' }); }
function verifyToken(token) {
  try { return findByUsername(jwt.verify(token, JWT_SECRET).u); } catch (e) { return null; }
}
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = token ? verifyToken(token) : null;
  if (!user) return res.status(401).json({ error: '로그인이 필요합니다.' });
  req.user = user;
  next();
}
function requireAdmin(req, res, next) {
  if (!req.user || !req.user.isAdmin) return res.status(403).json({ error: '관리자 권한이 필요합니다.' });
  next();
}

// ---------- express app ----------
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.redirect('/login.html'));
app.get('/health', (req, res) => res.json({ ok: true, time: Date.now() }));

app.post('/api/signup', async (req, res) => {
  const { username, password, adminCode } = req.body || {};
  if (!USERNAME_RE.test(username || '')) {
    return res.status(400).json({ error: '아이디는 영문/숫자/밑줄 3~16자여야 합니다.' });
  }
  if (!password || password.length < 4) {
    return res.status(400).json({ error: '비밀번호는 4자 이상이어야 합니다.' });
  }
  if (findByUsername(username)) {
    return res.status(409).json({ error: '이미 사용 중인 아이디입니다.' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const isAdmin = !!(ADMIN_SIGNUP_CODE && adminCode && adminCode === ADMIN_SIGNUP_CODE);
  const status = isAdmin ? 'approved' : 'pending';
  const user = { username, passwordHash, balance: START_BALANCE, isAdmin, status, createdAt: Date.now() };
  users[username.toLowerCase()] = user;
  await persistUser(username.toLowerCase());

  if (status === 'pending') {
    return res.json({ pending: true, message: '가입 신청이 완료되었습니다. 관리자 승인 후 로그인할 수 있어요.' });
  }
  const token = signToken(user);
  res.json({ token, username: user.username, isAdmin: user.isAdmin, balance: user.balance });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  const user = findByUsername(username || '');
  if (!user) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  const ok = await bcrypt.compare(password || '', user.passwordHash);
  if (!ok) return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  if (user.status !== 'approved') return res.status(403).json({ error: '관리자 승인 대기 중입니다. 승인 후 로그인해주세요.' });
  const token = signToken(user);
  res.json({ token, username: user.username, isAdmin: user.isAdmin, balance: user.balance });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ username: req.user.username, isAdmin: req.user.isAdmin, balance: req.user.balance });
});

app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  let list;
  if (usersCollection) {
    const docs = await usersCollection.find({ _id: { $ne: '__write_test__' } }).toArray();
    list = docs.map(d => ({ username: d.username, balance: d.balance, isAdmin: d.isAdmin, status: d.status || 'approved', createdAt: d.createdAt }));
    for (const d of docs) {
      users[d._id] = { username: d.username, passwordHash: d.passwordHash, balance: d.balance, isAdmin: d.isAdmin, status: d.status || 'approved', createdAt: d.createdAt };
    }
  } else {
    list = Object.values(users).map(u => ({ username: u.username, balance: u.balance, isAdmin: u.isAdmin, status: u.status, createdAt: u.createdAt }));
  }
  list.sort((a, b) => a.username.localeCompare(b.username));
  res.json({ users: list });
});

app.post('/api/admin/approve', requireAuth, requireAdmin, async (req, res) => {
  const target = await findByUsernameFresh((req.body || {}).username || '');
  if (!target) return res.status(404).json({ error: '해당 유저를 찾을 수 없습니다.' });
  target.status = 'approved';
  await persistUser(target.username.toLowerCase());
  res.json({ username: target.username, status: target.status });
});

app.post('/api/admin/reject', requireAuth, requireAdmin, async (req, res) => {
  const usernameLower = String((req.body || {}).username || '').toLowerCase();
  const target = await findByUsernameFresh(usernameLower);
  if (!target) return res.status(404).json({ error: '해당 유저를 찾을 수 없습니다.' });
  delete users[usernameLower];
  activeRounds.delete(usernameLower);
  if (usersCollection) { try { await usersCollection.deleteOne({ _id: usernameLower }); } catch (e) {} }
  else fileSaveAll();
  res.json({ username: target.username, deleted: true });
});

// 충전/차감 겸용: amount가 양수면 충전, 음수면 차감. 관리자 자신 포함 누구에게나 적용 가능.
app.post('/api/admin/recharge', requireAuth, requireAdmin, async (req, res) => {
  const { username, amount } = req.body || {};
  const target = await findByUsernameFresh(username || '');
  const amt = Math.trunc(Number(amount));
  if (!target) return res.status(404).json({ error: '해당 유저를 찾을 수 없습니다.' });
  if (!Number.isFinite(amt) || amt === 0 || Math.abs(amt) > 1000000) {
    return res.status(400).json({ error: `${CHIP} 조정 값이 올바르지 않습니다. (0이 아닌 -1,000,000 ~ 1,000,000)` });
  }
  const newBalance = target.balance + amt;
  if (newBalance < 0) {
    return res.status(400).json({ error: `차감 후 잔액이 음수가 됩니다. (현재 ${target.balance.toLocaleString('en-US')}${CHIP})` });
  }
  target.balance = newBalance;
  await persistUser(target.username.toLowerCase());
  pushBalance(target.username);
  res.json({ username: target.username, balance: target.balance });
});

const server = http.createServer(app);
const io = new Server(server);

const userSockets = new Map(); // usernameLower -> Set<socketId>

function socketIdsFor(usernameLower) { return userSockets.get(usernameLower) || new Set(); }
function pushBalance(username) {
  const lower = username.toLowerCase();
  const u = findByUsername(lower);
  for (const sid of socketIdsFor(lower)) {
    io.to(sid).emit('balance:update', { balance: u ? u.balance : 0 });
  }
}

io.use((socket, next) => {
  const token = socket.handshake.auth && socket.handshake.auth.token;
  const user = token ? verifyToken(token) : null;
  if (!user) return next(new Error('인증 실패'));
  if (user.status !== 'approved') return next(new Error('승인 대기 중'));
  socket.data.username = user.username;
  next();
});

io.on('connection', (socket) => {
  const username = socket.data.username;
  const lower = username.toLowerCase();
  if (!userSockets.has(lower)) userSockets.set(lower, new Set());
  userSockets.get(lower).add(socket.id);

  const u = findByUsername(lower);
  const existingRound = activeRounds.get(lower) || null;
  socket.emit('joined', {
    username,
    balance: u ? u.balance : 0,
    isAdmin: u ? u.isAdmin : false,
    round: existingRound,
  });

  socket.on('hilo:start', ({ betAmount }, ack) => {
    const amt = Math.trunc(Number(betAmount));
    if (!Number.isFinite(amt) || amt < 10) return ack && ack({ ok: false, error: '베팅 금액은 10 이상이어야 합니다.' });

    const target = findByUsername(lower);
    if (!target) return ack && ack({ ok: false, error: '사용자를 찾을 수 없습니다.' });
    if (activeRounds.has(lower)) return ack && ack({ ok: false, error: '이미 진행 중인 라운드가 있습니다.' });
    if (target.balance < amt) return ack && ack({ ok: false, error: `${CHIP}이 부족합니다. 관리자에게 충전을 요청하세요.` });

    target.balance -= amt;
    persistUser(lower);

    const card = drawCard();
    const round = { betAmount: amt, multiplier: 1, currentCard: card };
    activeRounds.set(lower, round);

    pushBalance(username);
    ack && ack({ ok: true, card, multiplier: 1, balance: target.balance, odds: getOdds(card.value) });
  });

  socket.on('hilo:guess', ({ direction }, ack) => {
    if (!['higher', 'lower'].includes(direction)) return ack && ack({ ok: false, error: 'direction이 올바르지 않습니다.' });
    const round = activeRounds.get(lower);
    if (!round) return ack && ack({ ok: false, error: '진행 중인 라운드가 없습니다.' });

    const odds = getOdds(round.currentCard.value);
    const chosen = odds[direction];
    if (!chosen || chosen.multiplier === null) return ack && ack({ ok: false, error: '현재 카드에서는 선택할 수 없는 방향입니다.' });

    const { win, drawnCard } = resolveGuess(round.currentCard.value, direction);

    if (win === null) { // push: 동점, 배수 변화 없이 재도전
      round.currentCard = drawnCard;
      return ack && ack({ ok: true, result: 'push', drawnCard, multiplier: round.multiplier, nextOdds: getOdds(drawnCard.value) });
    }

    if (!win) {
      activeRounds.delete(lower);
      return ack && ack({ ok: true, result: 'lose', drawnCard, multiplier: 0 });
    }

    round.multiplier = +(round.multiplier * chosen.multiplier).toFixed(2);
    round.currentCard = drawnCard;
    ack && ack({
      ok: true, result: 'win', drawnCard, multiplier: round.multiplier,
      potentialPayout: Math.round(round.betAmount * round.multiplier),
      nextOdds: getOdds(drawnCard.value),
    });
  });

  socket.on('hilo:cashout', (ack) => {
    const round = activeRounds.get(lower);
    if (!round) return ack && ack({ ok: false, error: '진행 중인 라운드가 없습니다.' });

    const payout = Math.round(round.betAmount * round.multiplier);
    const target = findByUsername(lower);
    target.balance += payout;
    persistUser(lower);
    activeRounds.delete(lower);

    pushBalance(username);
    ack && ack({ ok: true, payout, balance: target.balance });
  });

  socket.on('disconnect', () => {
    const set = userSockets.get(lower);
    if (set) { set.delete(socket.id); if (set.size === 0) userSockets.delete(lower); }
  });
});

(async () => {
  await initPersistence();
  server.listen(PORT, () => {
    console.log(`하이로 서버 실행 중: http://localhost:${PORT}`);
  });
})();
