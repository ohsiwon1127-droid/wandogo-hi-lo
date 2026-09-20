[README.md](https://github.com/user-attachments/files/32433956/README.md)
# Hilo 사이트 (회원 승인제 + 관리자 대시보드)

카드 예측(Hi-Lo) 게임 사이트. 회원가입은 **승인 대기** 상태로 시작하고, 관리자가 승인해야
로그인/플레이가 가능합니다. 가입 시 지급되는 잔액은 없고(0원), 관리자가 직접 충전/차감합니다.

## 폴더 구조

```
hilo-site/
├── server.js                # 진입점 (Express + Socket.io + Mongo 연결 + 관리자 계정 자동생성)
├── models/
│   ├── User.js               # 유저 (아이디/비밀번호 해시/잔액/승인상태/역할)
│   ├── HiloRound.js          # 게임 라운드 상태
│   └── BalanceLog.js         # 관리자 충전/차감 이력
├── services/
│   └── hiloEngine.js        # 확률/배당 계산, 카드 드로우 (동점=push 처리)
├── sockets/
│   └── hiloSocket.js        # socket.io 이벤트: start / guess / cashout
├── routes/
│   ├── auth.js               # 회원가입(승인대기) / 로그인 / 내 정보 조회
│   └── admin.js              # 관리자 전용: 승인/거절/충전/차감/통계
├── middleware/
│   └── auth.js               # JWT, 승인상태 체크, 관리자 권한 체크
├── public/
│   ├── index.html            # 플레이어 화면 (로그인/가입/게임, 예상 수령액 표시)
│   └── admin.html            # 관리자 대시보드
├── tests/
│   ├── fakeCollection.js     # 테스트용 인메모리 DB 대체 (실제 배포에는 불필요)
│   └── e2e.test.js           # 전체 흐름 자동 테스트
├── package.json
└── .env.example
```

## 1. 로컬 실행

```bash
cd hilo-site
npm install
cp .env.example .env
```

`.env`를 채우세요:

```
MONGODB_URI=mongodb+srv://<username>:<password>@<cluster>.mongodb.net/hilo?retryWrites=true&w=majority
JWT_SECRET=아무_긴_랜덤_문자열
PORT=3000
ADMIN_USERNAME=admin
ADMIN_PASSWORD=원하는_관리자_비밀번호
```

`JWT_SECRET`은 이렇게 하나 뽑아서 넣으면 됩니다:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

MongoDB Atlas 연결 방법은 이전 안내와 동일합니다 (Atlas 가입 → 클러스터 생성 → Database Access에서
DB 유저 생성 → Network Access 허용 → Connect에서 URI 복사, DB 이름은 `hilo`로).

## 2. 실행

```bash
npm start
```

`http://localhost:3000` → 플레이어 화면
`http://localhost:3000/admin.html` → 관리자 대시보드

**서버를 처음 실행하면** `.env`에 지정한 `ADMIN_USERNAME`/`ADMIN_PASSWORD`로 관리자 계정이
자동 생성됩니다 (이미 있으면 건너뜀). 이 계정으로 `/admin.html`에서 로그인하세요.

## 3. 사용 흐름

1. 플레이어가 `/`에서 아이디/비밀번호로 가입 신청 → **잔액 0원, 승인 대기 상태**로 생성됨
2. 승인 전에는 로그인 시도 시 "관리자 승인 대기중입니다" 메시지만 뜨고 로그인 불가
3. 관리자가 `/admin.html`에 로그인 → 대기중인 유저 목록에서 **승인** 클릭
4. 승인된 유저는 로그인 가능. 잔액은 여전히 0원이므로 베팅 시도 시 "잔액이 부족합니다" 오류
5. 관리자가 유저 목록에서 금액 입력 후 **충전** 클릭 → 유저 잔액 반영
6. 유저가 게임 플레이 (하이로: 높음/낮음 예측, 배수 누적, 캐시아웃)
7. 관리자가 필요 시 **차감**도 가능 (잔액보다 큰 금액은 차감 불가하도록 막아둠)
8. 모든 충전/차감은 `BalanceLog`에 기록됨 (`GET /api/admin/users/:id/balance-logs`)

## 4. API 요약

**인증 (`/api/auth`)**
- `POST /register` `{ username, password }` → 승인 대기 상태로 생성 (토큰 발급 안 함)
- `POST /login` `{ username, password }` → 승인된 계정만 `{ token, user }` 반환
- `GET /me` (인증 필요) → 최신 잔액 등 재확인

**관리자 (`/api/admin`, 전부 관리자 인증 필요)**
- `GET /users` → 전체 유저 목록 (비밀번호 해시 제외)
- `POST /users/:id/approve` / `/reject` / `/revoke`
- `POST /users/:id/balance` `{ amount, reason? }` → 양수=충전, 음수=차감
- `GET /users/:id/balance-logs` → 해당 유저 충전/차감 이력
- `GET /stats` → 전체 유저 수, 대기중 수, 전체 잔액 합계, 총 라운드 수, 총 베팅액

**게임 (Socket.io, 연결 시 `auth: { token }` 필요, 승인된 계정만 연결 가능)**
- `hilo:start` `{ betAmount }` → `{ roundId, card, odds, balance }`
- `hilo:guess` `{ roundId, direction: 'higher'|'lower' }` → `{ result: 'win'|'lose'|'push', drawnCard, multiplier, potentialPayout, nextOdds }`
- `hilo:cashout` `{ roundId }` → `{ payout, balance }`

## 5. 게임 로직

- 카드 값 2~14 (A=14 최고값), 매 드로우 독립적으로 표준 52장 분포에서 확률 계산
- **동점(Tie)은 push**: 승패 없이 배수 변화 없이 그대로 재도전
- 배당 = `(1 / 확률) × (1 - 하우스엣지)`, 확률은 동점을 제외한 유효 카드 수 기준
  (그래야 높음+낮음 확률 합이 정확히 100%가 되어 배당이 부풀려지지 않음)
- 하우스엣지 기본 1% (`services/hiloEngine.js`의 `DEFAULT_HOUSE_EDGE`)
- 극단 카드(2, A)에서 확정승리에 가까울 때 배당이 1 미만으로 떨어지지 않도록 최소 배당 1.01배 보정
- 잔액 차감/지급/충전/차감은 전부 `findOneAndUpdate` + `$inc` 원자적 처리 (동시 요청에도 안전)

## 6. 자동 테스트

`tests/e2e.test.js`는 User/HiloRound/BalanceLog 모델만 인메모리로 대체하고, 나머지
(인증, 승인 플로우, 관리자 권한, 게임 로직, 잔액 처리)는 실제 코드 그대로 검증합니다.

```bash
npm install
npm test
```

확인 항목: 회원가입→승인대기→로그인차단, 관리자 승인 후 로그인, 일반 유저의 admin API 접근 차단,
잔액 0원 상태 베팅 차단, 관리자 충전 후 플레이, 캐시아웃, 관리자 차감(잔액 초과 차감 차단),
거절 플로우, 통계 조회까지 전부 자동 확인됩니다.

## 7. Render.com 배포

1. GitHub에 프로젝트 push (⚠️ `models/`, `routes/`, `middleware/`, `public/` 폴더가
   전부 커밋에 포함됐는지 `git ls-files`로 반드시 확인하세요 — 누락되면 배포 시
   `Cannot find module` 에러가 납니다)
2. Render 대시보드 → New → Web Service → 저장소 연결
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Environment 탭에 `.env`의 값들(`MONGODB_URI`, `JWT_SECRET`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`) 등록
   (`PORT`는 Render가 자동 주입하므로 생략 가능)
6. MongoDB Atlas Network Access에서 접속 허용 설정
7. 배포 후 `/admin.html`에서 `.env`에 설정한 관리자 계정으로 로그인해서 운영 시작

배포 후에는 `server.js`의 `cors: { origin: "*" }`를 실제 도메인으로 제한하는 걸 권장합니다.

## 참고

- 관리자 비밀번호를 바꾸고 싶으면 `.env`의 `ADMIN_PASSWORD`를 바꿔도 **이미 생성된 계정에는 반영되지 않습니다**
  (서버는 계정이 이미 있으면 건드리지 않음). 비밀번호를 바꾸려면 DB에서 직접 수정하거나,
  별도의 "비밀번호 변경" 기능을 추가해야 합니다 (현재 버전엔 없음).
- 실제 결제·현금화(입출금, PG 연동)는 포함되어 있지 않습니다. 관리자가 수동으로 충전/차감하는
  방식입니다.
