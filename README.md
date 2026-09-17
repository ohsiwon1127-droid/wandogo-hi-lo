# Hilo 독립 사이트

카드 예측(Hi-Lo) 게임 사이트. 회원가입/로그인 + 잔액 관리 + 실시간 게임(Socket.io) + MongoDB 저장까지 포함된 독립 실행 프로젝트입니다.

## 폴더 구조

```
hilo-site/
├── server.js              # 진입점 (Express + Socket.io + Mongo 연결)
├── models/
│   ├── User.js             # 유저 (아이디/비밀번호 해시/잔액)
│   └── HiloRound.js         # 게임 라운드 상태
├── services/
│   └── hiloEngine.js       # 확률/배당 계산, 카드 드로우 (DB 무관 순수 로직)
├── sockets/
│   └── hiloSocket.js       # socket.io 이벤트: start / guess / cashout
├── routes/
│   └── auth.js             # POST /api/auth/register, /api/auth/login
├── middleware/
│   └── auth.js             # JWT 발급/검증, 소켓 인증 미들웨어
├── public/
│   └── index.html          # 테스트용 프론트엔드 (바닐라 JS)
├── package.json
└── .env.example
```

## 1. 로컬 실행

```bash
cd hilo-site
npm install
cp .env.example .env
```

`.env` 파일을 열어서 아래 값을 채우세요.

## 2. MongoDB Atlas 연결 설정

1. [MongoDB Atlas](https://www.mongodb.com/cloud/atlas) 가입 → 무료 클러스터(M0) 생성
2. **Database Access**에서 유저 생성 (아이디/비밀번호 지정)
3. **Network Access**에서 `0.0.0.0/0` 허용 (개발용) 또는 Render.com IP 대역 등록
4. **Connect → Drivers**에서 연결 문자열 복사, 형태는 다음과 같음:
   ```
   mongodb+srv://<username>:<password>@<cluster>.mongodb.net/hilo?retryWrites=true&w=majority
   ```
5. `.env`의 `MONGODB_URI`에 붙여넣기 (비밀번호에 특수문자가 있으면 URL 인코딩 필요)

`server.js`가 시작할 때 `mongoose.connect(process.env.MONGODB_URI)`로 자동 연결합니다.
연결 성공 시 콘솔에 `[db] MongoDB 연결 성공`이 찍힙니다.

`JWT_SECRET`은 아무 긴 랜덤 문자열이면 됩니다. 예:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## 3. 서버 실행

```bash
npm start
# 또는 개발 중엔
npm run dev
```

`http://localhost:3000` 접속하면 `public/index.html` 테스트 화면이 뜹니다.
회원가입 → 로그인 → 베팅 금액 입력 → 시작 → 높음/낮음 선택 → 캐시아웃 순서로 테스트 가능합니다.

## 4. API / 이벤트 요약

**REST**
- `POST /api/auth/register` `{ username, password }` → `{ token, user }`
- `POST /api/auth/login` `{ username, password }` → `{ token, user }`
- `GET /api/health` → DB 연결 상태 확인용

**Socket.io** (연결 시 `auth: { token }` 필요)
- `hilo:start` `{ betAmount }` → `{ roundId, card, odds, balance }`
- `hilo:guess` `{ roundId, direction: 'higher'|'lower' }` → `{ result, drawnCard, multiplier, nextOdds }`
- `hilo:cashout` `{ roundId }` → `{ payout, balance }`

## 5. Render.com 배포

1. GitHub에 이 프로젝트 push
2. Render 대시보드 → New → Web Service → 저장소 연결
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment 탭에서 `.env`에 있던 값들(`MONGODB_URI`, `JWT_SECRET`, `STARTING_BALANCE`)을 그대로 등록
   (`PORT`는 Render가 자동으로 주입하므로 따로 설정 안 해도 됨)
6. MongoDB Atlas **Network Access**에 Render 서버의 아웃바운드 IP를 허용하거나,
   테스트 단계에서는 `0.0.0.0/0`으로 열어두고 나중에 좁히기

배포 후 Socket.io CORS(`server.js`의 `cors: { origin: "*" }`)를 실제 프론트 도메인으로 제한하는 걸 권장합니다.

## 6. 게임 로직 요약

- 카드 값 2~14 (A=14, 최고값 취급), 매 드로우 독립적으로 표준 52장 분포에서 확률 계산 (덱 소모 추적 안 함 — "매 판 새로 섞인다"는 원본 규칙 반영)
- 배당 = `(1/확률) × (1 - 하우스엣지)`, 하우스엣지 기본 1% (`services/hiloEngine.js`의 `DEFAULT_HOUSE_EDGE`)
- 동점(Tie) 시 기본은 패배 처리 (`TIE_RULE = "loss"`), 필요시 `"push"`로 바꿔서 재드로우 로직 추가 가능
- 잔액 차감/지급은 `findOneAndUpdate` + `$inc`로 원자적 처리 (동시 요청 시 잔액 음수 방지)

## 참고

`STARTING_BALANCE`는 연습/데모용 가상 재화 지급액입니다. 실제 결제·현금화 기능(입출금, PG 연동)은 포함되어 있지 않으니, 그 부분이 필요하면 별도로 설계해야 합니다.
