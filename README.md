# barota
easy mobility guide for myself and seniors

## 기능
- 시작 메뉴에서 출근 / 퇴근 / 다른 경로(타는 역 → 내리는 역) 선택
- 경로를 단계별로 큰 글씨로 안내하고, 승차 단계마다 다음 열차·그다음 열차 도착 시간을 실시간 표시
- 경로 계산: `route.js` (브라우저에서 계산, 환승 1회당 7분 가산한 최소 시간 경로)
- 실시간 도착: `api/arrivals.js` (Vercel 함수, 환경변수 `SEOUL_SUBWAY_KEY`)

## 데이터
`data/subway.json`의 역·노선 연결 정보는 © OpenStreetMap contributors, ODbL 1.0 — `data/LICENSE.md` 참고.
