// 오병이어 계산 모듈 (명세서 4장).
// 참고 코드(docs/가계부_참고코드_gagyebu.html)의 계산 함수를 이름 그대로 옮기고, 명세서의 새 규칙을 더했다.
// 화면(브라우저)에서는 window.Calc, 테스트(node)에서는 require('./js/calc.js')로 쓴다.
// 개인정보: 이 파일은 계산만 한다. 아무 데도 보내지 않고, 콘솔에 내역을 찍지 않는다.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 날짜·월 도우미 ----------
  const pad = n => String(n).padStart(2, '0');
  const ymOf = d => d.slice(0, 7);
  const addYM = (ym, n) => {
    let [y, m] = ym.split('-').map(Number);
    m += n; y += Math.floor((m - 1) / 12); m = ((m - 1) % 12 + 12) % 12 + 1;
    return `${y}-${pad(m)}`;
  };
  const daysIn = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m, 0).getDate(); };
  const monthDiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
  const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const dateStr = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  // 그 달의 월요일 수 = 그 달의 주(월~일) 수. 예: 2026-11은 5주, 2026-12는 4주.
  function mondaysIn(ym) {
    const [y, m] = ym.split('-').map(Number);
    let n = 0;
    for (let d = 1; d <= daysIn(ym); d++) if (new Date(y, m - 1, d).getDay() === 1) n++;
    return n;
  }
  const sumBy = (list, f) => list.reduce((a, x) => a + f(x), 0);
  // 원리금 균등 상환: 잔액 B, 매달 pmt, 남은 n번 → 월 이자율 r (반으로 나눠 찾기)
  function solveRate(B, pmt, n) {
    if (!(B > 0) || !(pmt > 0) || pmt * n <= B) return 0;
    let lo = 0, hi = 0.05;
    for (let i = 0; i < 80; i++) {
      const r = (lo + hi) / 2, p = B * r / (1 - Math.pow(1 + r, -n));
      if (p > pmt) hi = r; else lo = r;
    }
    return (lo + hi) / 2;
  }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = n => Math.round(n || 0).toLocaleString('ko-KR');

  // ---------- 카드 청구 월 (4-1) ----------
  // 이용기간은 card.cycleStart에 시작하고, 이용기간이 끝나는 달의 다음 달에 청구된다.
  function billMonth(card, date) {
    const cs = +card.cycleStart || 1, day = +date.slice(8, 10);
    let start = ymOf(date); if (cs > 1 && day < cs) start = addYM(start, -1);
    const end = cs > 1 ? addYM(start, 1) : start;
    return addYM(end, 1);
  }

  // ---------- 할부 (4-2) ----------
  const instN = t => Math.max(1, parseInt(t.months, 10) || 1);
  // 카드사 방식: 월 금액은 100원 단위로 내리고, 남는 금액은 1회차에 붙인다.
  function instPart(t, k) {
    const n = instN(t), per = Math.floor(t.amount / n / 100) * 100;
    return k === 1 ? t.amount - per * (n - 1) : per;
  }

  // ---------- 명세서 업로드용 중복 키 (7-3) ----------
  // 가맹점 이름 정규화: (주)·㈜·주식회사, 공백, 괄호를 뺀다.
  const normMerchant = s => String(s || '').replace(/\(주\)|㈜|주식회사/g, '').replace(/[\s()[\]{}（）]/g, '').toLowerCase();
  // 카드id + 이용일 + 금액(할부면 총액) + 가맹점
  const importKey = t => [t.method, t.date, Math.round(+t.amount || 0), normMerchant(t.memo)].join('|');
  // 이미 있는 내역과 겹치는 것은 건너뛴다. 같은 파일 안에서 같은 키가 여러 번이면 dupInFile로 표시해 미리보기에서 고르게 한다.
  function dedupe(existing, incoming) {
    const have = new Set(existing.filter(t => !t.deleted).map(t => t.importKey || importKey(t)));
    const count = {};
    for (const t of incoming) { const k = importKey(t); count[k] = (count[k] || 0) + 1; }
    const add = [], skip = [];
    for (const t of incoming) {
      const k = importKey(t);
      const row = { ...t, importKey: k };
      if (count[k] > 1) row.dupInFile = count[k];
      (have.has(k) ? skip : add).push(row);
    }
    return { add, skip };
  }

  const DEFAULT_CATS = [['장보기', '필수'], ['외식', '선택'], ['카페·간식', '선택'], ['배달', '선택'], ['쇼핑·의류', '선택'], ['생활용품', '필수'], ['주유·교통', '필수'], ['병원·약국', '필수'], ['아이·교육', '필수'], ['경조사·헌금', '필수'], ['구독·통신', '필수'], ['여가·문화', '선택'], ['기타', '선택']].map(([name, kind]) => ({ name, kind }));

  const guessCat = n => /적금|저축|상환/.test(n) ? '저축·상환' : /보험|생명|화재|자녀보장/.test(n) ? '보험' : /학원|피아노|태권도|미술|수학|영어/.test(n) ? '아이·교육' : /자동차/.test(n) ? '자동차' : /십일조|헌금/.test(n) ? '경조사·헌금' : /용돈/.test(n) ? '용돈' : /교통/.test(n) ? '주유·교통' : /관리비|가스|코웨이|전기|수도/.test(n) ? '관리비·공과금' : /핸드폰|유플러스|통신|LG|SKT|KT|구독|Claude|ChatGPT|배민클럽|알림/.test(n) ? '구독·통신' : '기타';
  const feeCat = t => /할부수수료|연회비/.test(t.memo || '') ? '수수료·연회비' : t.category;

  // ---------- 데이터에 묶인 계산 ----------
  // data = { settings, tx }  (settings: cards, income, salary, incomeByMonth, extraIncome, fixed, plans, categories, loans, payday)
  function create(data) {
    const st = data.settings || {};
    // 들어온 돈(source: 'income')은 지출 계산에서 빼고 그 달 수입에 더한다
    const isIncome = t => t.source === 'income';
    const tx = (data.tx || []).filter(t => !t.deleted && !isIncome(t));
    const inTx = (data.tx || []).filter(t => !t.deleted && isIncome(t));
    const cards = () => st.cards || [];
    const cardOf = id => cards().find(c => c.id === id);
    const catKind = name => (st.categories || DEFAULT_CATS).find(c => c.name === name)?.kind || '선택';
    const txIn = M => tx.filter(t => ymOf(t.date) === M);

    // 첫 청구 월: billOverride가 있으면 그것(카드사가 늦게 매입한 건), 없으면 4-1 규칙.
    const firstBill = (t, c) => t.billOverride || billMonth(c, t.date);
    // M에 청구되는 할부 회차(1부터), 없으면 0.
    function instIndex(t, M) {
      const c = cardOf(t.method); if (!c) return 0;
      const i = monthDiff(firstBill(t, c), M) + 1;
      return i >= 1 && i <= instN(t) ? i : 0;
    }
    function installmentsIn(M) {
      return tx.filter(t => t.method !== 'cash' && instN(t) > 1).map(t => {
        const k = instIndex(t, M); if (!k) return null;
        let paid = 0; for (let j = 1; j <= k; j++) paid += instPart(t, j);
        return { t, k, n: instN(t), part: instPart(t, k), left: t.amount - paid };
      }).filter(Boolean).sort((a, b) => (a.n - a.k) - (b.n - b.k));
    }

    // ---------- 대출·일회성 수입 (4-6) ----------
    const loans = () => st.loans || [];
    function loanRepayIn(L, M) {
      const r = L.repay; if (!r) return 0;
      if (Array.isArray(r)) return sumBy(r.filter(x => x.month === M), x => +x.amount || 0);
      return (!r.from || r.from <= M) && (!r.until || M <= r.until) ? (+r.monthly || 0) : 0;
    }
    // M이 끝났을 때 남은 원금
    function loanLeft(L, M) {
      const P = +L.principal || 0;
      if (!L.startMonth || M < L.startMonth) return P;
      let paid = 0;
      for (let m = L.startMonth; m <= M; m = addYM(m, 1)) paid += loanRepayIn(L, m);
      return Math.max(0, P - paid);
    }
    // 이자는 받은 다음 달부터, 남은 원금이 있을 때만. interestMonthly가 있으면 그 금액, 없으면 남은 원금 × 연이율 ÷ 12.
    function loanFlow(M) {
      let received = 0, interest = 0, repay = 0;
      for (const L of loans()) {
        if (!L.startMonth || L.fixedId) continue;     // 고정지출로 내는 대출(자동차 할부 등)은 고정지출에서 이미 계산
        if (L.startMonth === M) received += +L.principal || 0;
        if (M < L.startMonth) continue;
        const left = loanLeft(L, addYM(M, -1));
        if (left <= 0) continue;
        if (M > L.startMonth) interest += L.interestMonthly != null && L.interestMonthly !== '' ? +L.interestMonthly : Math.round(left * (+L.rate || 0) / 1200);
        repay += Math.min(loanRepayIn(L, M), left);
      }
      return { received, interest, repay, out: interest + repay };
    }
    // 수입(M) = 그 달 수입(없으면 기본 수입) + 일회성 수입 + 그 달 받은 대출금
    function income(M) {
      const o = st.incomeByMonth?.[M];
      // 수입이 여러 사람·여러 날이면 incomeParts [{name, amount, day}] 합계
      const parts = Array.isArray(st.incomeParts) && st.incomeParts.length ? sumBy(st.incomeParts, p => +p.amount || 0) : null;
      const base = (o != null && o !== '') ? +o : parts != null ? parts : (+st.income || 0);
      const extra = sumBy((st.extraIncome || []).filter(x => x.month === M), x => +x.amount || 0);
      const cashIn = sumBy(inTx.filter(t => ymOf(t.date) === M), t => +t.amount || 0);
      return base + extra + cashIn + loanFlow(M).received;
    }

    // ---------- 고정지출 (4-3) ----------
    const fixedDate = (f, U) => `${U}-${pad(Math.min(Math.max(+f.day || 1, 1), daysIn(U)))}`;
    const fixedOn = (f, U) => f.active !== false && (!f.from || f.from <= U) && (!f.until || U <= f.until);
    // pct: 급여 × % (십일조 등) / perWeek: 주 금액 × 그 달 주 수 (아이들 용돈 등) / 그 밖: amount
    function fixedAmt(f, U) {
      if (f.pct) return Math.round((+st.salary || 0) * f.pct / 100);
      // 매달 조금씩 다른 정기 지출(관리비·달러 결제 구독 등): 최근 실제 금액 3번의 평균
      // 기록 = 저장된 recent + 이 고정지출과 맞춘 실제 내역(직접 입력·명세서). 같은 달은 실제 내역이 우선
      if (f.variable) {
        const byMonth = {};
        (f.recent || []).forEach(x => { byMonth[x.month] = +x.amount || 0; });
        const linked = {};
        tx.filter(t => f.id != null && String(t.fixedId) === String(f.id)).forEach(t => { const m = ymOf(t.date); linked[m] = (linked[m] || 0) + (+t.amount || 0); });
        Object.assign(byMonth, linked);
        const months = Object.keys(byMonth).filter(m => !U || m < U || linked[m] != null).sort().slice(-3);
        if (months.length) return Math.round(months.reduce((a, m) => a + byMonth[m], 0) / months.length);
      }
      if (f.perWeek) return (+f.perWeek || 0) * (U ? mondaysIn(U) : 4);
      return +f.amount || 0;
    }
    const fixedList = U => (st.fixed || []).filter(f => fixedOn(f, U));
    function fixedFor(method, U) { return fixedList(U).filter(f => f.method === method); }
    // 이중 계산 방지: 명세서에서 들어온 실제 내역(fixedId)이 같은 달(카드는 같은 청구 월)에 있으면 예상분을 뺀다.
    function replaced(f, M) {
      if (f.id == null) return false;
      return tx.some(t => t.fixedId === f.id && (t.method === 'cash' ? ymOf(t.date) === M : instIndex(t, M) > 0));
    }
    // M 청구에 들어가는 카드 고정지출 (사용월 M-3 ~ M에서 결제일 규칙으로 M에 떨어지는 것)
    function cardFixedIn(card, M) {
      const out = [];
      for (const U of [addYM(M, -3), addYM(M, -2), addYM(M, -1), M])
        for (const f of fixedFor(card.id, U))
          if (billMonth(card, fixedDate(f, U)) === M && !replaced(f, M)) out.push({ f, U, amount: fixedAmt(f, U) });
      return out;
    }
    const cashFixedIn = M => fixedFor('cash', M).filter(f => !replaced(f, M)).map(f => ({ f, U: M, amount: fixedAmt(f, M) }));

    // ---------- 카드 청구·정산 (4-4) ----------
    function cardBill(card, M) {
      let t_ = 0, inst = 0;
      for (const t of tx) if (t.method === card.id) {
        const k = instIndex(t, M);
        if (k) { const p = instPart(t, k); t_ += p; if (instN(t) > 1) inst += p; }
      }
      // 확정 명세서를 올린 달은 카드사가 실제로 청구하는 금액(명세서 합계)을 그대로 쓴다
      const confirmed = st.billConfirmed?.[card.id]?.[M];
      if (confirmed != null) return { tx: +confirmed, fx: 0, inst, total: +confirmed, confirmed: true };
      const fx = sumBy(cardFixedIn(card, M), x => x.amount);
      return { tx: t_, fx, inst, total: t_ + fx };
    }
    // settle(M) = 수입(M) − 카드 청구(M) − 현금 고정(M) − 현금 변동(M) − 대출 이자·상환(M)
    function settle(M) {
      const rows = cards().map(c => ({ card: c, ...cardBill(c, M) }));
      const cardTotal = sumBy(rows, r => r.total);
      const fixedCash = sumBy(cashFixedIn(M), x => x.amount);
      const cashVar = sumBy(tx.filter(t => t.method === 'cash' && ymOf(t.date) === M), t => t.amount);
      const loan = loanFlow(M);
      const inc = income(M);
      return { M, rows, cardTotal, fixedCash, cashVar, loanOut: loan.out, income: inc, balance: inc - cardTotal - fixedCash - cashVar - loan.out };
    }

    // ---------- 이번 달 예산(봉투) (4-5) ----------
    // today(YYYY-MM-DD)가 M 안에 있으면 주간 예산(weekly)의 이번 주 남은 금액도 계산한다.
    function planStatus(M, today) {
      let mon = null, sun = null;
      if (today && ymOf(today) === M) {
        const t = parseDate(today);
        const m = new Date(t); m.setDate(t.getDate() - ((t.getDay() + 6) % 7));
        const s = new Date(m); s.setDate(m.getDate() + 6);
        mon = dateStr(m); sun = dateStr(s);
      }
      return (st.plans || []).filter(p => p.active !== false && (+p.amount || 0) > 0).map(p => {
        const cats = p.cats || [p.category];
        const isCash = p.method === 'cash';
        const mine = txIn(M).filter(t => !t.isFixed && cats.includes(t.category) && ((t.method === 'cash') === isCash));
        const spent = sumBy(mine, t => t.amount);
        const r = { p, spent, remain: Math.max(0, +p.amount - spent), over: Math.max(0, spent - +p.amount), ratio: spent / +p.amount };
        if (p.weekly) {
          r.weekBudget = Math.round(+p.amount / mondaysIn(M));
          if (mon) r.weekRemain = r.weekBudget - sumBy(mine.filter(t => t.date >= mon && t.date <= sun), t => t.amount);
        }
        return r;
      });
    }

    // ---------- 갚아가는 중 (4-3 debtTotal, 4-6 loans) ----------
    function debts(M) {
      const out = [];
      for (const f of st.fixed || []) {
        if (!f.debtTotal || !f.debtStart || f.active === false) continue;
        const total = +f.debtTotal, amt = fixedAmt(f, M) || 1;
        const n = Math.max(0, monthDiff(f.debtStart, M) + 1);
        const before = +f.debtPaid || 0;                       // debtStart 전에 이미 갚은 돈
        const paid = Math.min(total, before + amt * n);
        out.push({ name: f.name, total, paid, left: total - paid, doneMonth: addYM(f.debtStart, Math.ceil(Math.max(0, total - before) / amt) - 1) });
      }
      for (const L of loans()) {
        if (!L.startMonth || M < L.startMonth || L.fixedId || L.balance != null) continue;   // 대출 칸(loanBook)에서 따로 보여 줌
        const total = +L.principal || 0, left = loanLeft(L, M);
        const r = L.repay;
        const doneMonth = Array.isArray(r) ? (r.map(x => x.month).sort().pop() || null) : (r && r.until) || null;
        out.push({ name: L.name, total, paid: total - left, left, doneMonth });
      }
      return out;
    }

    // ---------- 대출 칸 (자동차 할부·보험계약대출 등) ----------
    // L = { id, name, kind, balance(기준 달 납부 뒤 남은 원금), balanceMonth, monthly(매달 원리금), day, end(YYYY-MM),
    //       total(처음 원금), rate(연%, 없으면 원리금·잔액·남은 횟수로 짐작), interestMonthly(이자만 내는 대출) }
    function loanBook(today) {
      const M = ymOf(today), d = +today.slice(8, 10);
      return loans().filter(L => L.balance != null).map(L => {
        const paidThisMonth = d >= (+L.day || 1);
        const k = monthDiff(L.balanceMonth, M) - (paidThisMonth ? 0 : 1);   // 기준 달 뒤로 낸 횟수 (-1이면 기준 달 납부 전)
        let left = +L.balance, r = null;
        if (+L.monthly > 0 && L.end) {
          r = L.rate != null ? +L.rate / 1200 : solveRate(+L.balance, +L.monthly, Math.max(1, monthDiff(L.balanceMonth, L.end)));
          for (let i = 0; i < k && left > 0; i++) left = Math.max(0, left * (1 + r) - +L.monthly);
          for (let i = k; i < 0; i++) left = (left + +L.monthly) / (1 + r);   // 아직 이번 달 납부 전이면 그만큼 되돌림
        }
        left = Math.round(left);
        const total = +L.total || +L.balance;
        return {
          id: L.id, name: L.name, kind: L.kind || '', left, total, paid: Math.max(0, total - left),
          monthly: +L.monthly || 0, interestMonthly: +L.interestMonthly || 0,
          day: +L.day || null, end: L.end || null, rate: r != null ? Math.round(r * 1200 * 100) / 100 : (L.rate != null ? +L.rate : null)
        };
      });
    }

    // ---------- 모으는 중 (주택청약 등) ----------
    // S = { id, name, base(기준일까지 모은 돈), baseCount(기준일까지 회차), baseDate, match(입금 기록을 알아보는 말), monthly }
    // 기준일 다음부터, 분류가 저축·상환이고 사용처에 match(예: 청약)가 든 기록을 더한다 (또는 기록에 savingsId).
    function savingsBook() {
      return (st.savings || []).map(S => {
        const kw = String(S.match || '').trim();
        const deps = tx.filter(t => t.date > S.baseDate && (t.savingsId === S.id || (kw && String(t.memo || '').includes(kw) && /저축|적금|상환/.test(String(t.category || '')))))
          .sort((a, b) => (a.date < b.date ? -1 : 1));
        const added = sumBy(deps, t => +t.amount || 0);
        const last = deps.length ? deps[deps.length - 1].date : null;
        return { id: S.id, name: S.name, total: (+S.base || 0) + added, count: (+S.baseCount || 0) + deps.length, monthly: +S.monthly || 0, last, lastBase: S.baseDate, deposits: deps.length };
      });
    }

    // ---------- 다가오는 결제·월급날 (4-4-1) ----------
    function upcoming(today) {
      const M = ymOf(today), d = +today.slice(8, 10);
      const items = [];
      const byDay = {};
      for (const c of cards()) {
        const day = Math.min(+c.payDay || 15, daysIn(M));
        if (day < d) continue;
        if (st.billPaid?.[c.id]?.[M]) continue;          // 결제일 전에 미리 낸 카드값
        const amount = cardBill(c, M).total;
        if (!amount) continue;
        (byDay[day] ??= { day, kind: 'card', cards: [], parts: [], amount: 0 });
        byDay[day].cards.push(c.id); byDay[day].parts.push({ id: c.id, amount }); byDay[day].amount += amount;
      }
      items.push(...Object.values(byDay));
      const cardsDue = items.slice();
      // 월급날: incomeParts가 있으면 사람마다, 없으면 payday 하루에 전체 수입
      const pays = Array.isArray(st.incomeParts) && st.incomeParts.length
        ? st.incomeParts.map(p => ({ day: +p.day || 1, amount: +p.amount || 0, title: p.name }))
        : st.payday ? [{ day: +st.payday, amount: income(M), title: '월급' }] : [];
      for (const p of pays) {
        const pday = Math.min(p.day, daysIn(M));
        if (pday < d) continue;
        const out = sumBy(cashFixedIn(M).filter(x => Math.min(+x.f.day || 1, daysIn(M)) === pday), x => x.amount);
        items.push({ day: pday, kind: 'pay', title: p.title, amount: p.amount, outNow: out, after: p.amount - out });
      }
      items.sort((a, b) => a.day - b.day || (a.kind === 'pay' ? -1 : 1));
      const needBy = cardsDue.length ? { day: Math.max(...cardsDue.map(x => x.day)), amount: sumBy(cardsDue, x => x.amount) } : null;
      return { items, needBy };
    }

    // ---------- 홈 숫자 (6-1, 4-7) ----------
    // 이번 달 정산 = settle(M) − 현금 예산 남은 것 / 다음 달 예상 = settle(M+1) − 카드 예산 남은 것
    // 하루 쓸 수 있는 돈 = 다음 달 예상 ÷ 이번 달 남은 일수(오늘 포함), 100원 단위로 내림.
    function home(today) {
      const M = ymOf(today), N = addYM(M, 1);
      const cur = settle(M), next = settle(N);
      const plans = planStatus(M, today);
      const planCash = sumBy(plans.filter(x => x.p.method === 'cash'), x => x.remain);
      const planCard = sumBy(plans.filter(x => x.p.method !== 'cash'), x => x.remain);
      const settleThis = cur.balance - planCash, settleNext = next.balance - planCard;
      const daysLeft = daysIn(M) - +today.slice(8, 10) + 1;
      const perDay = daysLeft > 0 ? Math.floor(settleNext / daysLeft / 100) * 100 : 0;
      return { M, N, cur, next, plans, planCash, planCard, settleThis, settleNext, monthLeft: settleNext, daysLeft, perDay, debts: debts(M), loans: loanBook(today), savings: savingsBook(), ...upcoming(today) };
    }

    // ---------- 분석 (4-8) ----------
    // M에 나가는 돈: 카드 청구(할부 회차), 고정지출, 현금 지출
    function billItems(M) {
      const out = [];
      for (const t of tx) {
        const base = { memo: t.memo || t.category, category: feeCat(t), method: t.method, fixed: !!t.isFixed, t };
        if (t.method === 'cash') { if (ymOf(t.date) === M) out.push({ ...base, amount: t.amount }); continue; }
        const k = instIndex(t, M); if (!k) continue;
        out.push({ ...base, amount: instPart(t, k), inst: instN(t) > 1 ? { k, n: instN(t) } : null });
      }
      for (const c of cards()) for (const x of cardFixedIn(c, M))
        out.push({ memo: x.f.name, amount: x.amount, category: x.f.category || guessCat(x.f.name), method: c.id, fixed: true, virtual: true });
      for (const x of cashFixedIn(M))
        out.push({ memo: x.f.name, amount: x.amount, category: x.f.category || guessCat(x.f.name), method: 'cash', fixed: true, virtual: true });
      return out;
    }
    // M에 쓴 돈: 사용일 기준, 전체 금액
    function useItems(M) {
      return txIn(M).map(t => ({ memo: t.memo || t.category, amount: t.amount, category: feeCat(t), method: t.method, fixed: !!t.isFixed, inst: instN(t) > 1 && t.method !== 'cash' ? { k: 0, n: instN(t) } : null, t }));
    }
    const kindOf = i => i.fixed ? '필수' : catKind(i.category);

    function analyze(M, basis = 'bill') {
      const get = m => basis === 'bill' ? billItems(m) : useItems(m);
      const items = get(M);
      const sum = a => a.reduce((x, i) => x + i.amount, 0);
      const byCat = l => { const o = {}; for (const i of l) o[i.category] = (o[i.category] || 0) + i.amount; return o; };
      const cc = byCat(items), cnt = {}; for (const i of items) cnt[i.category] = (cnt[i.category] || 0) + 1;
      const nReal = items.filter(i => !i.virtual).length;
      // 기록 수가 비슷한 달만 비교 (반쯤 입력한 달과 비교하지 않기)
      const prevMs = [1, 2, 3].map(k => addYM(M, -k)).filter(p => { const n = get(p).filter(i => !i.virtual).length; return n >= 15 && n >= nReal * 0.5; });
      const avg = {}; for (const p of prevMs) { const b = byCat(get(p)); for (const k in b) avg[k] = (avg[k] || 0) + b[k] / prevMs.length; }
      const cats = Object.keys(cc).sort((a, b) => cc[b] - cc[a]);
      const need = items.filter(i => kindOf(i) === '필수'), want = items.filter(i => kindOf(i) !== '필수');
      const real = items.filter(i => i.t);
      const flagged = real.filter(i => i.t.unneeded).sort((a, b) => b.amount - a.amount);
      const rising = prevMs.length ? cats.filter(c => catKind(c) !== '필수' && avg[c] > 0 && cc[c] > avg[c] * 1.2 && cc[c] - avg[c] >= 20000).map(c => ({ c, now: cc[c], avg: avg[c], diff: cc[c] - avg[c] })) : [];
      const memo = {}; for (const i of real.filter(i => !i.inst && !i.fixed)) { const k = i.memo.replace(/\s*\(.*\)$/, '').trim(); (memo[k] ??= { k, n: 0, s: 0, cat: i.category }); memo[k].n++; memo[k].s += i.amount; }
      const repeats = Object.values(memo).filter(m => m.n >= 3).sort((a, b) => b.s - a.s);
      const small = want.filter(i => i.t && !i.inst && i.amount < 15000);
      const bigWant = want.filter(i => i.t && !i.fixed).sort((a, b) => b.amount - a.amount).slice(0, 5);
      return {
        basis, items, total: sum(items), need: sum(need), want: sum(want), cc, cnt, avg, cats, prevMs, flagged, rising, repeats, small, smallSum: sum(small), bigWant,
        card: sum(items.filter(i => i.method !== 'cash')), cash: sum(items.filter(i => i.method === 'cash')), inst: sum(items.filter(i => i.inst)), fixed: sum(items.filter(i => i.fixed))
      };
    }

    // 점검할 지출 목록. html은 화면용(사용자 입력은 모두 esc 처리).
    function insights(A, M) {
      const out = [], I = A.items, inc = income(M);
      const sum = a => a.reduce((x, i) => x + i.amount, 0);
      const add = (k, cls, html, amt) => out.push({ k, cls, html, amt });
      const on = I.filter(i => i.category === '온라인쇼핑' && !i.inst);
      if (sum(on) >= 200000 || on.length >= 10) {
        const g = {}; for (const i of on) { const k = /쿠팡/.test(i.memo) ? '쿠팡' : /네이버/.test(i.memo) ? '네이버페이' : '기타 온라인'; (g[k] ??= { n: 0, s: 0 }); g[k].n++; g[k].s += i.amount; }
        add('온라인쇼핑', 'up', `${Object.entries(g).sort((a, b) => b[1].s - a[1].s).map(([k, v]) => `${k} ${v.n}회 <span class="num">${won(v.s)}</span>`).join(' · ')}<div class="small muted">장보기·생필품이 섞여 있을 수 있어요. 장바구니에 모아 주 1~2회만 결제하면 충동구매가 줄어요.</div>`, sum(on));
      }
      const tel = I.filter(i => i.category === '구독·통신' && /유플러스|LGU|LG U|SKT|KT|통신|핸드폰/.test(i.memo));
      const subs = I.filter(i => i.category === '구독·통신' && !tel.includes(i));
      if (tel.length) {
        const hi = tel.filter(i => !i.virtual && i.amount >= 80000);
        add('통신비', 'up', `핸드폰·인터넷 ${tel.length}건${hi.length ? ` — 8만원 넘는 회선 ${hi.length}개 (${hi.map(i => won(i.amount)).join(', ')})` : ''}<div class="small muted">회선별 요금제, 단말기 할부가 같이 나가는지, 가족 결합할인이 되어 있는지 확인해 보세요. 할부가 끝난 폰은 알뜰폰으로 회선당 3~5만원 줄일 수 있어요.</div>`, sum(tel));
      }
      if (subs.length && sum(subs) >= 30000) add('구독', 'rep', `${subs.map(i => esc(i.memo.replace(/\s*\(.*\)$/, ''))).join(' · ')}<div class="small muted">안 쓰는 구독이 없는지, 비슷한 서비스를 둘 다 쓰고 있지 않은지 점검해 보세요.</div>`, sum(subs));
      const ins = I.filter(i => i.category === '보험');
      if (ins.length) {
        const pct = inc ? Math.round(sum(ins) / inc * 100) : null;
        add('보험료', pct != null && pct > 10 ? 'bad' : 'rep', `${ins.length}건${pct != null ? ` — 수입의 <b>${pct}%</b>` : ''}${pct != null && pct > 10 ? ' (보통 10% 안팎을 권해요)' : ''}<div class="small muted">${ins.slice().sort((a, b) => b.amount - a.amount).slice(0, 4).map(i => `${esc(i.memo)} ${won(i.amount)}`).join(' · ')}${ins.length > 4 ? ' …' : ''}<br>보장이 겹치는지 설계사에게 '보장 분석'을 받아보세요. 해지는 손해가 날 수 있으니 바로 결정하지 마세요.</div>`, sum(ins));
      }
      const food = I.filter(i => ['외식', '배달', '카페·간식'].includes(i.category) && !i.inst);
      if (food.length >= 4) {
        const per = sum(food) / food.length, save = Math.round(per * 4 / 10000) * 10000;
        add('외식·배달·카페', 'up', `외식 ${food.filter(i => i.category === '외식').length}회 · 배달 ${food.filter(i => i.category === '배달').length}회 · 카페 ${food.filter(i => i.category === '카페·간식').length}회<div class="small muted">한 번에 평균 ${won(per)}원. 일주일에 한 번만 줄여도 한 달 약 <b>${won(save)}원</b>이 남아요.</div>`, sum(food));
      }
      const inst = I.filter(i => i.inst && i.inst.k);
      if (inst.length) {
        const end = inst.filter(i => i.inst.k === i.inst.n);
        add('할부 상환', 'rep', `${inst.length}건 진행 중${end.length ? ` — 이번 달로 끝나는 할부 ${end.length}건: ${end.map(i => esc(i.memo.replace(/\s*\(.*\)$/, ''))).join(', ')}<div class="small muted">다음 달부터 <b>${won(sum(end))}원</b>이 덜 나가요.</div>` : ''}`, sum(inst));
      }
      const fee = I.filter(i => i.category === '수수료·연회비');
      if (fee.length) add('수수료·연회비', 'bad', `${fee.map(i => esc(i.memo)).join(' · ')}<div class="small muted">큰 금액을 할부할 땐 무이자인지 꼭 확인하세요.</div>`, sum(fee));
      const etc = I.filter(i => i.category === '기타' && !i.fixed && !/수수료|연회비/.test(i.memo)).sort((a, b) => b.amount - a.amount);
      if (etc.length) add('확인 필요', 'rep', `분류가 '기타'인 지출: ${etc.slice(0, 5).map(i => `${esc(i.memo)} <span class="num">${won(i.amount)}</span>`).join(' · ')}<div class="small muted">정기결제라면 해지할 수 있는 것인지 확인해 보세요. 설정 → 분류 정리에서 한꺼번에 바꿀 수 있어요.</div>`, sum(etc));
      if (A.flagged.length) add('불필요 표시', 'bad', `직접 '불필요'로 표시한 지출 ${A.flagged.length}건<div class="small muted">${A.flagged.slice(0, 4).map(i => `${esc(i.memo)} ${won(i.amount)}`).join(' · ')}</div>`, sum(A.flagged));
      for (const r of A.rising) add('평소보다 ↑', 'up', `${esc(r.c)} — 최근 ${A.prevMs.length}개월 평균 ${won(r.avg)}원보다 ${Math.round((r.now / r.avg - 1) * 100)}% 많아요`, r.diff);
      for (const r of A.repeats.filter(r => !['쿠팡', '쿠팡페이', '네이버페이'].includes(r.k)).slice(0, 3)) add('반복 지출', 'rep', `'${esc(r.k)}' ${r.n}회 <span class="small muted">(${esc(r.cat)})</span>`, r.s);
      return out;
    }

    return {
      billMonth, instN, instPart, instIndex, installmentsIn, fixedOn, fixedAmt, fixedFor, fixedList, fixedDate,
      cardBill, settle, income, loanFlow, loanBook, savingsBook, planStatus, debts, upcoming, home, billItems, useItems, analyze, insights, txIn
    };
  }

  return { create, solveRate, billMonth, instN, instPart, importKey, normMerchant, dedupe, addYM, ymOf, daysIn, monthDiff, mondaysIn, guessCat, DEFAULT_CATS };
});
