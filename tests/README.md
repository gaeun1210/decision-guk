# 자동 회귀 테스트

테스트 페이지에서는 SRI 검사를 빼고(가짜 서버를 끼우기 위해) 실제 Supabase 대신 **가짜 서버(fake2.js, fake3.js)** 를 끼워 화면 동작을 검사한다. 운영 DB·실제 계정은 쓰지 않는다.

| 파일 | 내용 |
|---|---|
| qa.mjs | 기본 동선 28개 (안건 접수→판결, 근거·표결 규칙, 여론, 모바일) |
| fix.mjs | 실제 사이트 사용 점검 12건 수정 확인 35개 |
| rel.mjs | 정식 제출 전 수정(인수인계서) 확인 24개 — 삭제 확인, 저장 실패 복구, 여론 오류 상태, 신고 사유, 모달 키보드, 모바일 360/390, 공유 이미지, 개인정보 화면 |
| engine.mjs | 장관 독립 판단(규칙 v2) 15개 — J-01 끌림은 낭만주의만, J-02 10회 반복 동일, J-03 이견 토론, J-04 근거 실패/성공, J-05 판단 보류, J-06 살까말까 회귀, J-07 구매 비교, 화면 흐름 |
| sec.mjs | 보안 회귀 13개 — XSS(판결·공유·기록실·홈·여론), 숨김 글 표시, 장관 판결 기록 연결, SRI·CSP·키 노출 |

실행 (저장소 폴더에서, 한 줄씩):

```
npm i -D playwright@1.49.1 && npx playwright install chromium
python3 -m http.server 8771 &
node tests/qa.mjs && node tests/fix.mjs && node tests/rel.mjs && node tests/sec.mjs && node tests/engine.mjs
```

GitHub에 올리면(push·pull request) `.github/workflows/test.yml`이 같은 테스트를 자동으로 돌린다.
DB 권한(RLS·함수 권한·투표 전 득표 비공개)은 브라우저 테스트로 확인할 수 없으므로 Supabase에서 SQL로 따로 확인했다(README 참고).
