// 명세서 13장 수용 테스트 (모두 가짜 숫자). 실행: npm test  (또는 node --test tests/*.test.js)
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const Calc = require('../js/calc.js');

const A = { id: 'A', name: 'A카드', cycleStart: 1, payDay: 13 };
const B = { id: 'B', name: 'B카드', cycleStart: 12, payDay: 15 };
const make = (settings = {}, tx = []) => Calc.create({ settings: { cards: [A, B], ...settings }, tx });

test('1. 청구 월', () => {
  assert.equal(Calc.billMonth(A, '2026-10-31'), '2026-11');
  assert.equal(Calc.billMonth(B, '2026-10-05'), '2026-11');
  assert.equal(Calc.billMonth(B, '2026-10-15'), '2026-12');
});

test('2. 할부 금액', () => {
  const t1 = { amount: 100000, months: 3 };
  assert.deepEqual([1, 2, 3].map(k => Calc.instPart(t1, k)), [33400, 33300, 33300]);
  const t2 = { amount: 98100, months: 10 };
  assert.equal(Calc.instPart(t2, 1), 9900);
  for (let k = 2; k <= 10; k++) assert.equal(Calc.instPart(t2, k), 9800);
  assert.equal([...Array(10)].reduce((s, _, i) => s + Calc.instPart(t2, i + 1), 0), 98100);
});

test('3. 할부 회차', () => {
  const t = { method: 'A', date: '2026-07-18', amount: 500000, months: 5 };
  const c = make({}, [t]);
  assert.equal(c.instIndex(t, '2026-08'), 1);
  assert.equal(c.instIndex(t, '2026-10'), 3);
  assert.equal(c.instIndex(t, '2026-12'), 5);
  assert.equal(c.instIndex(t, '2027-01'), 0);
});

test('4. billOverride (늦은 매입)', () => {
  const t = { method: 'A', date: '2026-06-15', amount: 90000, months: 3, billOverride: '2026-08' };
  const c = make({}, [t]);
  assert.equal(c.instIndex(t, '2026-10'), 3);
  assert.equal(c.instIndex(t, '2026-07'), 0);   // 원래 규칙이면 7월 1회차지만, 덮어쓴 값을 따름
});

test('5. 고정지출 기간', () => {
  const c = make({ fixed: [{ name: '학습지', amount: 125000, method: 'cash', day: 10, from: '2026-10', until: '2026-11' }] });
  assert.equal(c.settle('2026-10').fixedCash, 125000);
  assert.equal(c.settle('2026-11').fixedCash, 125000);
  assert.equal(c.settle('2026-12').fixedCash, 0);
  assert.equal(c.settle('2026-09').fixedCash, 0);
});

test('6. 퍼센트 고정', () => {
  const f = { name: '십일조', pct: 10, method: 'cash', day: 25 };
  const c = make({ salary: 3000000, fixed: [f] });
  assert.equal(c.fixedAmt(f, '2026-11'), 300000);
  assert.equal(c.settle('2026-11').fixedCash, 300000);
});

test('7. 이중 계산 방지 (명세서 실제 금액이 예상분을 대신함)', () => {
  const f = { id: 'f1', name: '통신비', amount: 50000, method: 'A', day: 8, matchKeyword: '통신' };
  const before = make({ fixed: [f] });
  assert.equal(before.cardBill(A, '2026-11').total, 50000);          // 명세서 올리기 전: 예상분
  const after = make({ fixed: [f] }, [{ method: 'A', date: '2026-10-08', amount: 52000, memo: 'LG유플러스 통신', isFixed: true, fixedId: 'f1' }]);
  const bill = after.cardBill(A, '2026-11');
  assert.equal(bill.total, 52000);                                    // 실제 52,000만
  assert.equal(bill.fx, 0);
  assert.equal(after.cardBill(A, '2026-12').total, 50000);            // 다음 달은 다시 예상분
});

test('8. 정산', () => {
  const c = make(
    { income: 5000000, fixed: [{ name: '생활비 이체', amount: 2500000, method: 'cash', day: 25 }] },
    [{ method: 'A', date: '2026-10-10', amount: 2000000, category: '기타' }]
  );
  const s = c.settle('2026-11');
  assert.equal(s.cardTotal, 2000000);
  assert.equal(s.fixedCash, 2500000);
  assert.equal(s.balance, 500000);
});

test('9. 이번 달 예산(봉투)', () => {
  const c = make(
    { income: 5000000, plans: [{ name: '장보기', category: '장보기', amount: 400000, method: 'card', weekly: true }] },
    [{ method: 'A', date: '2026-11-05', amount: 150000, category: '장보기' }]
  );
  const p = c.planStatus('2026-11', '2026-11-10')[0];
  assert.equal(p.remain, 250000);
  assert.equal(p.weekBudget, 80000);       // 40만 ÷ 11월 5주
  assert.equal(p.weekRemain, 80000);       // 11/9~11/15 주에는 아직 안 씀
  const h = c.home('2026-11-10');
  assert.equal(h.planCard, 250000);
  assert.equal(h.settleNext, c.settle('2026-12').balance - 250000);   // 다음 달 예상에서 250,000 더 뺌
});

test('10. 중복 (같은 파일을 두 번 올리면 두 번째는 0건)', () => {
  const file = [
    { method: 'A', date: '2026-10-03', amount: 12000, memo: '(주)동네마트 본점' },
    { method: 'A', date: '2026-10-04', amount: 300000, months: 3, memo: '전자상가' },
    { method: 'B', date: '2026-10-04', amount: 8000, memo: '카페' }
  ];
  const first = Calc.dedupe([], file);
  assert.equal(first.add.length, 3);
  const second = Calc.dedupe(first.add, file);
  assert.equal(second.add.length, 0);
  assert.equal(second.skip.length, 3);
  // 가맹점 이름 표기만 달라도 같은 것으로 봄
  assert.equal(Calc.importKey({ method: 'A', date: '2026-10-03', amount: 12000, memo: '동네마트 본점' }), first.add[0].importKey);
  // 같은 파일 안에 정말 두 번 있으면 표시해서 사용자가 고르게 함
  const twice = Calc.dedupe([], [file[2], file[2]]);
  assert.equal(twice.add[0].dupInFile, 2);
});

test('11. 개인정보 (저장소에 .xls를 넣은 커밋이면 검사 실패)', () => {
  const script = path.join(__dirname, '..', 'tools', 'check-repo.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'obye-check-'));
  try {
    const git = (...a) => execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', ...a], { cwd: dir, stdio: 'pipe' });
    git('init', '-q');
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html>');
    git('add', '.'); git('commit', '-q', '-m', 'ok');
    assert.equal(spawnSync(process.execPath, [script, dir]).status, 0, '깨끗한 저장소는 통과');

    fs.writeFileSync(path.join(dir, 'card.xls'), 'fake');
    git('add', '.'); git('commit', '-q', '-m', 'bad');
    const r = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
    assert.equal(r.status, 1, '.xls가 있으면 실패');
    assert.match(r.stderr, /card\.xls/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- 인계 문서의 새 규칙 (13장 밖, 함께 확인) ----------
test('추가. 주 단위 고정지출 (월요일 수)', () => {
  assert.equal(Calc.mondaysIn('2026-11'), 5);
  assert.equal(Calc.mondaysIn('2026-12'), 4);
  const f = { name: '아이들 용돈', perWeek: 30000, method: 'cash', day: 1 };
  const c = make({ fixed: [f] });
  assert.equal(c.settle('2026-11').fixedCash, 150000);
  assert.equal(c.settle('2026-12').fixedCash, 120000);
});

test('추가. 갚아가는 중 (debtTotal·debtStart)', () => {
  const c = make({ fixed: [{ name: '가족 차용금', amount: 200000, method: 'cash', day: 25, debtTotal: 1000000, debtStart: '2026-09' }] });
  const d = c.debts('2026-11')[0];
  assert.equal(d.paid, 600000);             // 9·10·11월 3번
  assert.equal(d.left, 400000);
  assert.equal(d.doneMonth, '2027-01');     // 5번째 납부 달
  assert.equal(c.debts('2027-03')[0].paid, 1000000);   // 총액을 넘지 않음
});

test('추가. 일회성 수입·대출', () => {
  const c = make({
    income: 3000000,
    extraIncome: [{ month: '2026-11', name: '식대', amount: 100000 }],
    loans: [{ name: '보험계약대출', principal: 1200000, rate: 6, startMonth: '2026-11', repay: { from: '2026-12', monthly: 100000 } }]
  });
  assert.equal(c.income('2026-11'), 3000000 + 100000 + 1200000);
  assert.equal(c.income('2026-12'), 3000000);
  const dec = c.loanFlow('2026-12');
  assert.equal(dec.interest, 6000);         // 120만 × 6% ÷ 12
  assert.equal(dec.repay, 100000);
  assert.equal(c.loanFlow('2027-01').interest, 5500);   // 남은 110만 기준
  assert.equal(c.debts('2026-12').find(x => x.name === '보험계약대출').left, 1100000);
});

test('추가. 다가오는 결제·월급날', () => {
  const c = make(
    { income: 4000000, payday: 25, fixed: [{ name: '관리비', amount: 300000, method: 'cash', day: 25 }] },
    [{ method: 'A', date: '2026-10-20', amount: 600000, category: '기타' }, { method: 'B', date: '2026-10-05', amount: 400000, category: '기타' }]
  );
  const u = c.upcoming('2026-11-10');
  assert.deepEqual(u.items.map(x => [x.day, x.kind]), [[13, 'card'], [15, 'card'], [25, 'pay']]);
  assert.deepEqual(u.needBy, { day: 15, amount: 1000000 });
  assert.equal(u.items[2].outNow, 300000);
  assert.equal(u.items[2].after, 3700000);
  assert.deepEqual(c.upcoming('2026-11-14').items.map(x => x.day), [15, 25]);   // 지난 결제일은 빠짐
});

test('추가. 하루 쓸 수 있는 돈', () => {
  const c = make({ income: 3000000 }, [{ method: 'A', date: '2026-11-02', amount: 2370000, category: '기타' }]);
  const h = c.home('2026-11-10');           // 12월 정산 630,000 ÷ 남은 21일
  assert.equal(h.daysLeft, 21);
  assert.equal(h.settleNext, 630000);
  assert.equal(h.perDay, 30000);
});

test('추가. 분석(analyze·insights)이 오류 없이 돈다', () => {
  const tx = [];
  for (let i = 1; i <= 6; i++) tx.push({ method: 'A', date: `2026-11-0${i}`, amount: 20000, category: '배달', memo: '치킨' });
  tx.push({ method: 'B', date: '2026-11-03', amount: 300000, months: 3, category: '쇼핑·의류', memo: '<패딩>', unneeded: true });
  const c = make({ income: 4000000, fixed: [{ name: '유플러스 통신', amount: 90000, method: 'A', day: 5 }] }, tx);
  // 쓴 돈 기준은 11월, 나가는 돈(카드 청구) 기준은 12월에 잡힘
  for (const [basis, M] of [['use', '2026-11'], ['bill', '2026-12']]) {
    const An = c.analyze(M, basis);
    assert.ok(An.total > 0);
    const ins = c.insights(An, M);
    assert.ok(ins.some(x => x.k === '외식·배달·카페'));
    assert.ok(!ins.some(x => x.html.includes('<패딩>')), '사용자 글자는 이스케이프');
  }
});

test('추가. 확정 명세서를 올린 달은 명세서 합계를 그대로 청구로 씀', () => {
  const c = make(
    { fixed: [{ id: 'f1', name: '통신비', amount: 50000, method: 'A', day: 8 }], billConfirmed: { A: { '2026-11': 300000 } } },
    [{ method: 'A', date: '2026-10-10', amount: 123456 }]
  );
  const b = c.cardBill(A, '2026-11');
  assert.equal(b.total, 300000); assert.equal(b.fx, 0); assert.equal(b.confirmed, true);
  assert.equal(c.cardBill(A, '2026-12').total, 50000);       // 확정 안 된 달은 원래 계산
});

test('추가. 매달 달라요(variable) 고정지출은 최근 실제 금액 3번의 평균', () => {
  const f = { id: 'v1', name: '아파트관리비', amount: 341610, method: 'cash', day: 25, variable: true,
    recent: [{ month: '2026-08', amount: 100000 }, { month: '2026-09', amount: 300000 }, { month: '2026-10', amount: 330000 }, { month: '2026-11', amount: 401100 }] };
  const c = make({ fixed: [f] });
  assert.equal(c.fixedAmt(f, '2026-12'), Math.round((300000 + 330000 + 401100) / 3));
  assert.equal(c.fixedAmt({ ...f, recent: [] }, '2026-12'), 341610);    // 기록이 없으면 등록 금액
});

test('추가. 대출 칸: 원리금·잔액·남은 횟수로 이자율 짐작, 달마다 남은 원금 (납부일 전후)', () => {
  // 가짜 숫자: 남은 원금 1,000,000, 매달 90,000, 12번 남음
  const r = Calc.solveRate(1000000, 90000, 12);
  assert.ok(Math.abs(1000000 * r / (1 - Math.pow(1 + r, -12)) - 90000) < 1);
  const L = { id: 'car', name: '자동차 할부', balance: 1000000, balanceMonth: '2026-11', monthly: 90000, day: 15, end: '2027-11', total: 1500000, fixedId: 'c01' };
  const c = make({ loans: [L] });
  const after = c.loanBook('2026-11-20')[0];
  assert.equal(after.left, 1000000);
  const before = c.loanBook('2026-11-10')[0];             // 11월 15일 납부 전 → 그만큼 더 남음
  assert.ok(before.left > 1000000 && before.left < 1090000);
  const dec = c.loanBook('2026-12-20')[0];
  assert.ok(dec.left < 1000000 && dec.left > 910000);       // 원금은 매달 원리금보다 조금 덜 줄어듦
  assert.equal(c.loanFlow('2026-12').out, 0);               // 고정지출로 내는 대출은 정산에 두 번 안 들어감
});

test('추가. 모으는 중: 기준일 금액·회차에 그 뒤 입금 기록을 더함', () => {
  const c = make({ savings: [{ id: 'cy', name: '주택청약', base: 5000000, baseCount: 100, baseDate: '2026-11-11', match: '청약', monthly: 100000 }] }, [
    { method: 'cash', date: '2026-11-01', amount: 100000, memo: '청약 입금', category: '저축·상환' },   // 기준일 전 → 이미 포함
    { method: 'cash', date: '2026-12-05', amount: 100000, memo: '청약 입금', category: '저축·상환' },
    { method: 'cash', date: '2026-12-06', amount: 30000, memo: '청약 카페', category: '카페·간식' },     // 분류가 저축이 아니면 안 셈
    { method: 'cash', date: '2027-01-05', amount: 200000, memo: '이체', category: '기타', savingsId: 'cy' }
  ]);
  const s = c.savingsBook()[0];
  assert.equal(s.total, 5300000); assert.equal(s.count, 102); assert.equal(s.last, '2027-01-05');
});

test('추가. 들어온 돈(source income)은 그 달 수입에 더하고 지출에는 안 넣음', () => {
  const c = make({ income: 3000000 }, [
    { method: 'cash', date: '2026-11-03', amount: 50000, memo: '중고 판매', category: '기타 수입', source: 'income' },
    { method: 'cash', date: '2026-11-04', amount: 20000, memo: '시장', category: '장보기' }
  ]);
  const s = c.settle('2026-11');
  assert.equal(s.income, 3050000);
  assert.equal(s.cashVar, 20000);
  assert.equal(s.balance, 3030000);
});

test('추가. 수입이 두 사람·두 날이면 날마다 따로 (incomeParts)', () => {
  const c = make({ incomeParts: [{ name: '내 급여', amount: 3400000, day: 5 }, { name: '남편', amount: 2700000, day: 10 }],
    fixed: [{ name: '학원', amount: 200000, method: 'cash', day: 5 }] });
  assert.equal(c.income('2026-12'), 6100000);
  const u = c.upcoming('2026-12-01').items.filter(x => x.kind === 'pay');
  assert.deepEqual(u.map(x => [x.day, x.title, x.amount, x.outNow]), [[5, '내 급여', 3400000, 200000], [10, '남편', 2700000, 0]]);
});
