// 명세서 읽기 테스트 (명세서 7장). 실제 명세서와 같은 '모양'으로 만든 가짜 숫자 예시만 쓴다.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const St = require('../js/statement.js');

// 현대카드 모양: HTML 표, 날짜 'YYYY년 MM월 DD일', 할부/회차 '10/3', 닫는 태그에 공백(</td >)
const HYUNDAI = `<html><body><table>
<tr><td colspan="10">2026년 11월 이용대금명세서</td></tr>
<tr><td>결제 상세내역</td></tr>
<tr><th>이용일</th><th>이용카드</th><th>이용가맹점</th><th>이용금액</th><th>할부/회차</th><th>적립/할인율(%)</th><th>예상적립/할인</th><th>결제원금</th><th>결제후잔액</th><th>수수료(이자)</th></tr>
<tr><td>2026년 10월 05일</td><td>본인 TEST 1</td><td>동네마트</td ><td>12,000</td><td> </td><td>1%</td><td>0</td><td>12,000</td><td>0</td><td>0</td></tr>
<tr><td>2026년 10월 06일</td><td>본인 TEST 1</td><td>(주)빵집</td ><td>5,000</td><td> </td><td>1%</td><td>0</td><td>4,500</td><td>0</td><td>0</td></tr>
<tr><td>2026년 10월 07일</td><td>본인 TEST 1</td><td>쿠폰사용</td ><td>3,000</td><td> </td><td>0%</td><td>0</td><td>0</td><td>0</td><td>0</td></tr>
<tr><td>2026년 08월 20일</td><td>본인 TEST 2</td><td>전자상가</td ><td>300,000</td><td>3/3</td><td>0%</td><td>0</td><td>100,000</td><td>0</td><td>1,200</td></tr>
<tr><td>-</td><td></td><td>총 합계 4 건</td><td></td><td></td><td></td><td></td><td>116,500</td><td>0</td><td>1,200</td></tr>
</table></body></html>`;

// 신한카드 모양: 머리글 두 줄(rowspan), 날짜 'YYYY.MM.DD', 연회비 줄은 날짜 없음
const SHINHAN = `<html><table><tr><td>2026년11월 이용대금명세서(신용카드)</td></tr></table>
<table><tr><td>4. 이용내역</td></tr>
<tr><th rowspan="2">이용일</th><th rowspan="2">이용카드</th><th rowspan="2">이용가맹점</th><th rowspan="2">이용금액</th><th rowspan="2">할부기간</th><th rowspan="2">회차</th><th colspan="2">이번달 납부금액</th><th rowspan="2">적용 구분</th><th rowspan="2">결제 후 잔액</th></tr>
<tr><th>원금</th><th>수수료(이자)</th></tr>
<tr><td>2026.10.03</td><td>본인123</td><td>약국</td><td>8,000</td><td></td><td></td><td>8,000</td><td>0</td><td></td><td>0</td></tr>
<tr><td>일시불 합계</td><td></td><td></td><td></td><td></td><td></td><td>8,000</td><td>0</td><td></td><td>0</td></tr>
<tr><td></td><td>본인123</td><td>연회비</td><td>10,000</td><td></td><td></td><td>10,000</td><td>0</td><td></td><td>0</td></tr>
<tr><td>총합계</td><td></td><td></td><td></td><td></td><td></td><td>18,000</td><td>0</td><td></td><td>0</td></tr></table>
<table><tr><th>이용일</th><th>이용가맹점</th><th>적용구분</th><th>이용금액</th></tr><tr><td>2026.10.03</td><td>할인표</td><td>할인</td><td>500</td></tr></table></html>`;

// 우리카드 모양(SheetJS로 읽은 행): 날짜 'MM.DD'(연도 없음), 청구 월 없음, 혜택 뺀 원금, 국외는 수수료 더함
const WOORI = [
  ['', '', '', '이용대금 명세서'],
  [],
  ['이용일', '', '', '', '카드구분', '이용카드', '매출구분', '', '이용가맹점(은행)명', '', '이용금액\n(해외현지/체크카드)', '할부개월', '당월 결제하실 금액', '', '', '', '', '결제후잔액'],
  ['', '', '', '', '', '', '', '', '', '', '', '', '회차', '원금', '혜택금액', '환율', '수수료', ''],
  ['10.02', '', '', '', '본인/신용', '1234', '국내일시불', '', '최고수학학원', '', '200000', '', '', '200000', '0', '', '0', '0'],
  ['10.09', '', '', '', '본인/신용', '1234', '국내일시불', '', '카페', '', '10000', '', '', '9000', '1000', '', '0', '0'],
  ['10.12', '', '', '', '본인/신용', '1234', '국외일시불', '', 'ONLINE SHOP', '', '20', '', '', '27000', '0', '1350.00', '300', '0'],
  ['09.15', '', '', '', '본인/신용', '1234', '국내할부', '', '가구점', '', '60000', '2', '2', '30000', '0', '', '0', '0']
];

// 삼성카드 모양: 날짜 'YYYYMMDD', 일시불합계 줄
const SAMSUNG = [
  ['청구요약'], [], ['이용자', '카드번호', '카드명', '원금', '이자/수수료'], ['본 인', '****-9999', '테스트카드', '15000', '0'], [],
  ['일시불'], [],
  ['이용일', '이용구분', '가맹점', '이용금액', '총할부금액', '이용혜택', '혜택금액', '개월', '회차', '원금', '이자/수수료', '포인트명', '적립금액', '입금후잔액'],
  ['20261003', '본 인 999', '편의점', '5,000', '', '', '', '', '', '5000', '0', '', '0', '0'],
  ['20261004', '본 인 999', '주유소', '10,000', '', '', '', '', '', '10000', '0', '', '0', '0'],
  ['', '', '일시불합계', '', '', '', '', '', '', '15000', '0', '', '0', '0']
];

test('현대카드: 칸 밀림 없이 읽고, 할인은 결제원금, 0원은 건너뛰고, 할부는 총액·회차', () => {
  const p = St.parse(St.htmlRows(HYUNDAI), 'hyundaicard_20261110.xls', '2026-11-11');
  assert.equal(p.company, 'hyundai');
  assert.equal(p.billMonth, '2026-11');
  assert.equal(p.items.length, 3);
  assert.equal(p.skippedZero, 1);
  assert.deepEqual(p.items.map(x => [x.date, x.merchant, x.amount]), [['2026-10-05', '동네마트', 12000], ['2026-10-06', '(주)빵집', 4500], ['2026-08-20', '전자상가', 300000]]);
  const inst = p.items[2];
  assert.equal(inst.months, 3); assert.equal(inst.k, 3); assert.equal(inst.firstBill, '2026-09'); assert.equal(inst.fee, 1200);
  assert.equal(p.check.expected, 116500);
  assert.equal(p.check.got, 116500);      // 명세서 합계와 같음
});

test('신한카드: 두 줄 머리글, 연회비(날짜 없음), 할인표는 읽지 않음', () => {
  const p = St.parse(St.htmlRows(SHINHAN), '2026년11월 이용대금명세서(신용카드).xls', '2026-11-11');
  assert.equal(p.company, 'shinhan');
  assert.equal(p.billMonth, '2026-11');
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0].date, '2026-10-03');
  assert.ok(p.items[1].annualFee);
  assert.equal(p.items[1].date, '2026-10-01');
  assert.equal(p.check.expected, 18000);
  assert.equal(p.check.got, 18000);
});

test('우리카드: 연도·청구 월 짐작, 혜택 뺀 원금, 국외 수수료 더함, 할부 회차로 연도', () => {
  const p = St.parse(WOORI, 'report.xls', '2026-11-11');
  assert.equal(p.company, 'woori');
  assert.equal(p.billMonth, '2026-11');
  assert.equal(p.billFrom, 'guess');
  assert.deepEqual(p.items.map(x => x.amount), [200000, 9000, 27300, 60000]);
  assert.equal(p.items[3].date, '2026-09-15');
  assert.equal(p.items[3].firstBill, '2026-10');
  St.setBillMonth(p, '2027-01');          // 사용자가 청구 월을 바꾸면 날짜도 다시
  assert.equal(p.items[0].date, '2026-10-02');
});

test('삼성카드: YYYYMMDD 날짜, 일시불합계와 같음', () => {
  const p = St.parse(SAMSUNG, 'samsungcard_20261113.xlsx', '2026-11-11');
  assert.equal(p.company, 'samsung');
  assert.equal(p.billMonth, '2026-11');
  assert.equal(p.items.length, 2);
  assert.equal(p.items[0].date, '2026-10-03');
  assert.equal(p.check.expected, 15000);
  assert.equal(p.check.got, 15000);
});

const cards = [{ id: 'H1', name: '현대카드', cycleStart: 1, payDay: 15 }, { id: 'H2', name: '현대카드(기아)', cycleStart: 1, payDay: 15 }, { id: 'W', name: '우리카드', cycleStart: 1, payDay: 15 }];
const categories = ['장보기', '카페·간식', '아이·교육', '수수료·연회비', '기타'];

test('가계부와 맞추기: 같은 카드사 다른 카드에 있어도 이미 있음, 할부수수료는 따로, 늦은 매입은 청구 월 덮어쓰기', () => {
  const p = St.parse(St.htmlRows(HYUNDAI), 'hyundaicard_20261110.xls', '2026-11-11');
  const existing = [{ id: 'a', method: 'H2', date: '2026-10-05', amount: 12000, memo: '마트', months: 1 }];
  const rows = St.plan(p, () => 'H1', { cards, tx: existing, fixed: [], categories, rules: {}, companyCards: ['H1', 'H2'] });
  assert.equal(rows[0].status, 'dup');                         // 카드는 달라도 같은 카드사·날짜·금액
  assert.equal(rows.filter(r => r.status === 'new').length, 3); // 빵집, 전자상가, 할부수수료
  const fee = rows.find(r => /할부수수료/.test(r.t.memo));
  assert.equal(fee.t.amount, 1200); assert.equal(fee.t.category, '수수료·연회비'); assert.equal(fee.t.billOverride, '2026-11');
  const inst = rows.find(r => r.t.memo === '전자상가');
  assert.equal(inst.t.months, 3); assert.equal(inst.t.billOverride, undefined);   // 8/20 사용 → 9월 첫 청구는 규칙과 같음
});

test('가계부와 맞추기: 고정지출 이름으로 맞추고, 금액이 다르면 바꿀지 묻기', () => {
  const p = St.parse(WOORI, 'report.xls', '2026-11-11');
  const fixed = [{ id: 'f9', name: '수학학원', amount: 180000, method: 'W', day: 2, category: '아이·교육' }];
  const rows = St.plan(p, () => 'W', { cards, tx: [], fixed, categories, rules: {}, companyCards: ['W'] });
  const r = rows.find(x => x.t.memo === '최고수학학원');
  assert.equal(r.t.isFixed, true); assert.equal(r.t.fixedId, 'f9'); assert.equal(r.t.category, '아이·교육');
  assert.deepEqual(r.t.fixedChange, { id: 'f9', name: '수학학원', from: 180000, to: 200000 });
});

test('가계부와 맞추기: 같은 날 금액만 조금 다르면 확인 필요, 같은 파일 두 번이면 0건', () => {
  const p = St.parse(SAMSUNG, 'samsungcard_20261113.xlsx', '2026-11-11');
  const sc = [{ id: 'S', name: '삼성카드', cycleStart: 1, payDay: 13 }];
  const rows = St.plan(p, () => 'S', { cards: sc, tx: [{ method: 'S', date: '2026-10-03', amount: 5500, memo: '편의점' }], fixed: [], categories, rules: {}, companyCards: ['S'] });
  assert.equal(rows[0].status, 'similar');
  const first = St.plan(p, () => 'S', { cards: sc, tx: [], fixed: [], categories, rules: {}, companyCards: ['S'] });
  const again = St.plan(p, () => 'S', { cards: sc, tx: first.map(r => r.t), fixed: [], categories, rules: {}, companyCards: ['S'] });
  assert.equal(again.filter(r => r.status === 'new').length, 0);
});

test('확정 명세서 합계: 카드별 이번 달 청구(할부 회차 원금+수수료), 예정 명세서는 없음', () => {
  const p = St.parse(St.htmlRows(HYUNDAI), 'hyundaicard_20261110.xls', '2026-11-11');
  const tot = St.billTotals(p, label => /TEST2/.test(label) ? 'H2' : 'H1');
  assert.deepEqual(tot, { H1: 16500, H2: 101200 });
  assert.equal(St.billTotals({ ...p, predicted: true }, () => 'H1'), null);
});

test('가계부와 맞추기: 이름이 같아도 금액이 30% 넘게 다르면 고정지출과 맞추지 않음', () => {
  const p = St.parse(WOORI, 'report.xls', '2026-11-11');
  const fixed = [{ id: 'f8', name: '수학학원 (3명)', amount: 600000, method: 'W', day: 2 }];
  const rows = St.plan(p, () => 'W', { cards, tx: [], fixed, categories, rules: {}, companyCards: ['W'] });
  assert.equal(rows.find(x => x.t.memo === '최고수학학원').t.isFixed, false);
});

test('아직 오지 않은 달의 청구서는 예정으로 보고 확정 합계를 만들지 않음', () => {
  const p = St.parse(WOORI, 'report (1).xls', '2026-10-20');      // 오늘이 10월이면 11월 청구서는 아직 예정
  assert.equal(p.billMonth, '2026-11');
  assert.equal(p.predicted, true);
  assert.equal(St.billTotals(p, () => 'W'), null);
});

test('매달 달라요 표시한 고정지출은 금액이 달라도 묻지 않고, 60%까지 같은 것으로 봄', () => {
  const p = St.parse(WOORI, 'report.xls', '2026-11-11');
  const fixed = [{ id: 'f7', name: '수학학원', amount: 140000, method: 'W', day: 2, variable: true }];
  const r = St.plan(p, () => 'W', { cards, tx: [], fixed, categories, rules: {}, companyCards: ['W'] }).find(x => x.t.memo === '최고수학학원');
  assert.equal(r.t.fixedId, 'f7');
  assert.equal(r.t.fixedChange, undefined);
});

test('직접 적은 기록은 명세서로 바꿔 끼움: 같은 금액·3일 안, 같은 날 금액만 다름, 고정지출로 적은 것', () => {
  const p = St.parse(St.htmlRows(HYUNDAI), 'hyundaicard_20261110.xls', '2026-11-11');
  const existing = [
    { id: 'm1', source: 'manual', method: 'H1', date: '2026-10-07', amount: 12000, memo: '마트', months: 1 },   // 2일 차이, 같은 금액
    { id: 'm2', source: 'manual', method: 'H1', date: '2026-10-06', amount: 5500, memo: '빵', months: 1 }        // 같은 날, 할인 전 금액
  ];
  const rows = St.plan(p, () => 'H1', { cards, tx: existing, fixed: [], categories, rules: {}, companyCards: ['H1', 'H2'] });
  const mart = rows.find(r => r.t.memo === '동네마트'), bread = rows.find(r => r.t.memo === '(주)빵집');
  assert.equal(mart.status, 'replace'); assert.equal(mart.t.replaces, 'm1');
  assert.equal(bread.status, 'replace'); assert.equal(bread.t.replaces, 'm2');
  // 한 기록은 한 줄하고만 짝지음
  assert.equal(rows.filter(r => r.t.replaces === 'm1').length, 1);

  const w = St.parse(WOORI, 'report.xls', '2026-11-11');
  const fixed = [{ id: 'f9', name: '수학학원', amount: 200000, method: 'W', day: 2, category: '아이·교육' }];
  const mine = [{ id: 'm3', source: 'manual', method: 'W', date: w.items.find(x => /수학/.test(x.merchant)).date.slice(0, 8) + '28', amount: 180000, memo: '수학학원', months: 1, fixedId: 'f9' }];
  const wr = St.plan(w, () => 'W', { cards, tx: mine, fixed, categories, rules: {}, companyCards: ['W'] });
  const r = wr.find(x => x.t.memo === '최고수학학원');
  assert.equal(r.status, 'replace'); assert.equal(r.t.replaces, 'm3'); assert.equal(r.t.fixedId, 'f9');
});
