[README.md](https://github.com/user-attachments/files/32451144/README.md)
# 하이로 (Hi-Lo) 라이브 사이트

카드 예측(Hi-Lo) 게임 사이트. **카드 랩 바카라 프로젝트와 완전히 동일한 구조**로 만들었습니다 —
단일 `server.js`, `mongodb` 네이티브 드라이버 + 메모리 캐시, 같은 API 경로(`/api/signup`,
`/api/login`, `/api/me`, `/api/admin/*`), 같은 로그인/회원가입/관리자 화면 디자인. **게임 로직만
하이로로 바뀌었습니다.**

바카라와 다른 점 하나: 하이로는 유저별 개인 게임이라 바카라처럼 전원이 같은 라운드를 공유하는
베팅 타이머가 필요 없습니다. 그래서 각자 카드가 다르게 나오고, 진행 중인 라운드는 서버 메모리에만
있다가 캐시아웃하거나 실패하면 사라집니다 (잔액만 DB에 저장됨).

## 폴더 구조

```
hilo-v2/
├── server.js          # 전체 로직이 담긴 단일 서버 파일 (바카라와 동일한 패턴)
├── package.json
├── .env.example
├── data/              # MONGODB_URI 없을 때 로컬 저장용 (자동 생성됨)
└── public/
    ├── login.html      # 로그인/회원가입 (관리자 코드 입력칸 포함)
    ├── game.html        # 하이로 게임 화면
    └── admin.html        # 관리자 패널 (가입승인 · 칩 충전/차감 · 유저 검색)
```

## 1. 로컬 실행

```bash
npm install
cp .env.example .env
```

`.env`를 채우세요:

```
PORT=3000
JWT_SECRET=아무_긴_랜덤_문자열
ADMIN_SIGNUP_CODE=원하는_관리자_가입코드
MONGODB_URI=mongodb+srv://...   (선택. 없으면 data/users.json 파일에 저장)
```

```bash
npm start
```

`http://localhost:3000` → 자동으로 `/login.html`로 이동

## 2. 관리자 계정 만들기

**별도의 관리자 부트스트랩 계정이 없습니다.** 회원가입 화면에서:
- 아이디: 원하는 대로
- 비밀번호: 원하는 대로 (본인이 정하는 로그인 비밀번호)
- 관리자 코드: `.env`의 `ADMIN_SIGNUP_CODE`와 똑같이 입력

이렇게 가입하면 **승인 대기 없이 즉시 관리자 계정**이 만들어지고, 로그인은 방금 본인이 정한
비밀번호로 합니다 (관리자 코드는 가입 시 한 번만 쓰이고, 로그인 비밀번호와는 완전히 별개입니다).

일반 유저는 관리자 코드 칸을 비워두고 가입하면 되고, 이 경우 승인 대기 상태가 되어 관리자가
`/admin.html`에서 승인해줘야 로그인할 수 있습니다.

## 3. 관리자 화면 접근

`admin.html`은 별도 로그인창이 없습니다. `login.html`에서 로그인한 뒤 저장된 토큰
(`localStorage`의 `hilo_token`)을 그대로 사용하고, 로그인 응답의 `isAdmin` 값에 따라
자동으로 `admin.html` 또는 `game.html`로 이동합니다. 토큰이 없거나 만료되면 `admin.html`
접근 시 자동으로 `login.html`로 돌아갑니다.

## 4. 사용 흐름

1. 일반 유저 가입 → 승인 대기, 잔액 0
2. 관리자가 `/admin.html`에서 승인
3. 승인된 유저 로그인 가능하지만 잔액 0이라 베팅 시 "칩이 부족합니다" 안내
4. 관리자가 유저 목록에서 검색 후 충전/차감 (금액 입력 + 충전/차감 토글, 또는 빠른 +100/+500/-100/-500 버튼)
   — **관리자 자신의 계정도 충전 가능**하므로 관리자도 게임을 플레이할 수 있습니다
5. 유저(관리자 포함)가 `/game.html`에서 플레이: 배팅 → 카드 확인 → 높음/낮음 예측 → 배수 누적 → 캐시아웃
6. 관리자가 "삭제" 버튼을 누르면 해당 계정이 **완전히 삭제**됩니다 (대기 중인 가입 거부와
   기존 계정 삭제를 겸함). 관리자 자기 자신은 삭제할 수 없도록 서버에서 막혀 있습니다.

## 5. API 요약 (카드 랩과 동일한 경로/응답 형식)

- `POST /api/signup` `{ username, password, adminCode? }`
  → 관리자 코드 일치 시 `{ token, username, isAdmin, balance }`, 아니면 `{ pending: true, message }`
- `POST /api/login` `{ username, password }` → `{ token, username, isAdmin, balance }`
- `GET /api/me` (인증 필요) → `{ username, isAdmin, balance }`
- `GET /api/admin/users` (관리자 전용) → `{ users: [{ username, balance, isAdmin, status, createdAt }] }`
- `POST /api/admin/approve` `{ username }`
- `POST /api/admin/reject` `{ username }` → 계정 완전 삭제 (자기 자신은 불가)
- `POST /api/admin/recharge` `{ username, amount }` → 양수=충전, 음수=차감 (0이 아닌 절대값 1,000,000 이하)

**Socket.io** (연결 시 `auth: { token }`)
- `hilo:start` `{ betAmount }` → `{ card, multiplier, balance, odds }`
- `hilo:guess` `{ direction: 'higher'|'lower' }` → `{ result: 'win'|'lose'|'push', drawnCard, multiplier, potentialPayout?, nextOdds? }`
- `hilo:cashout` → `{ payout, balance }`
- `balance:update` (서버 → 클라이언트) 관리자가 충전/차감했을 때 실시간으로 잔액 갱신

## 6. 게임 로직

- 카드 값 2~14 (A=14 최고값), 무늬는 실제 기호(♠♥♦♣) + 색상 정보 포함
- 매 드로우마다 독립적으로 표준 52장 분포에서 확률 계산 (덱 소모 추적 안 함)
- **동점은 push**: 승패 없이 배수 변화 없이 재도전. 확률 분모는 동점을 제외한 카드 수 기준
  (그래야 높음+낮음 확률 합이 정확히 100%가 되어 배당이 부풀려지지 않음)
- 배당 = `(1/확률) × (1 - 하우스엣지 1%)`, 극단 카드에서 배당이 1 밑으로 안 떨어지게 최소 1.01배 보정

## 7. Render.com 배포

1. GitHub에 push (`git ls-files`로 `public/` 폴더 전체가 커밋됐는지 확인)
2. Render → New → Web Service → 저장소 연결
3. Build: `npm install` / Start: `npm start`
4. Environment에 `JWT_SECRET`, `ADMIN_SIGNUP_CODE`, `MONGODB_URI` 등록 (`PORT`는 자동 주입)
5. MongoDB Atlas Network Access 허용 설정
6. 배포 후 `/login.html`에서 회원가입 화면의 관리자 코드로 관리자 계정 생성 후 시작

## 참고

- `MONGODB_URI`를 비워두면 로컬 `data/users.json` 파일에 저장됩니다. Render 같은 호스팅은
  재배포/재시작 시 디스크가 초기화될 수 있으니 실제 운영에는 반드시 MongoDB를 연결하세요.
- 진행 중인 하이로 라운드는 서버 메모리에만 있어서 서버가 재시작되면 사라집니다 (잔액은 안전).
- `ADMIN_SIGNUP_CODE`가 노출되면 누구나 관리자가 될 수 있으니 외부에 공유하지 마세요.
