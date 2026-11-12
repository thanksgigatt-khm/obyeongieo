// 오병이어 — 화면.
// 시트 주소(js/config.js)가 있으면 실제 모드: 비밀번호로 로그인하고 구글 시트 데이터를 보여 준다.
// 없거나 주소 끝에 ?demo 를 붙이면 예시 모드: 가짜 데이터(DEMO)로 화면만 본다.
(function () {
  const LIVE = !!(window.API && API.enabled() && window.Calc && !/[?&]demo\b/.test(location.search));
  let D = window.DEMO;
  const $app = document.getElementById('app');
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

  // ---------- 작은 도구 ----------
  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem('obye.' + k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem('obye.' + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 화면은 동작 */ } }
  };
  const fmt = n => Math.round(n).toLocaleString('ko-KR');
  const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '') + fmt(Math.abs(n));
  const man = n => n >= 10000 ? (Math.round(n / 1000) / 10).toString() + '만' : fmt(n);
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const ymd = dt => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const addMonth = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return ymd(d).slice(0, 7); };
  const monthLabel = ym => `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;
  const cardOf = id => D.cards.find(c => c.id === id) || { name: id, color: '#6A6356' };
  const mondaysIn = ym => { let n = 0; const [y, m] = ym.split('-').map(Number); for (let d = new Date(y, m - 1, 1); d.getMonth() === m - 1; d.setDate(d.getDate() + 1)) if (d.getDay() === 1) n++; return n; };
  const monthTx = ym => D.tx.filter(t => t.date.startsWith(ym));

  // ---------- 실제 데이터 (시트) ----------
  const CASH = { id: 'cash', name: '현금', color: '#6A6356' };
  const ymLabel = ym => `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;
  function liveData() {
    const st = API.settings();
    const today = ymd(new Date()), month = today.slice(0, 7);
    const all = API.list('내역').filter(t => !t.deleted && t.date && t.amount)
      .map(t => ({ ...t, amount: +t.amount, months: +t.months || 1, category: t.category || '기타', memo: t.memo || '' }));
    const tx = all.filter(t => t.source !== 'income'), incomes = all.filter(t => t.source === 'income');   // 들어온 돈은 따로
    const C = Calc.create({ settings: st, tx: all });
    const cards = [...(st.cards || []).map(c => ({ ...c, color: c.color || '#3B6EA8' })), CASH];
    const categories = (st.categories || Calc.DEFAULT_CATS).map(c => typeof c === 'string' ? c : c.name);
    const fixed = (st.fixed || []).filter(f => C.fixedOn(f, month)).map(f => ({ ...f, amount: C.fixedAmt(f, month) }));
    const plans = (st.plans || []).filter(p => p.active !== false && +p.amount > 0).map(p => ({ ...p, amount: +p.amount }));
    const heldAll = API.list('참았어요').filter(h => !h.deleted);
    const heldM = heldAll.filter(h => (h.date || '').startsWith(month));
    const heldY = heldAll.filter(h => (h.date || '').startsWith(month.slice(0, 4)));
    const kinds = {}; heldM.forEach(h => { kinds[h.kind] = (kinds[h.kind] || 0) + 1; });
    const sumAmt = l => l.reduce((s, h) => s + (+h.amount || 0), 0);
    const ready = (st.cards || []).length > 0 || +st.income > 0;
    let home = null;
    if (ready) {
      const h = C.home(today);
      const cname = id => (cards.find(c => c.id === id) || { name: id }).name;
      home = {
        perDay: h.perDay, monthLeft: h.monthLeft, settleThis: h.settleThis, settleNext: h.settleNext,
        // 같은 날 결제도 카드사마다 한 줄 (현대카드·현대카드(기아)·하이패스처럼 한 카드사는 한 청구서라 한 줄로)
        upcoming: h.items.flatMap(u => {
          if (u.kind === 'pay') return [{ day: u.day, kind: 'pay', title: u.title || '월급', amount: u.amount, outNow: u.outNow, after: u.after }];
          const groups = {};
          u.parts.forEach(pt => { const base = cname(pt.id).replace(/\s*\(.*\)\s*$/, ''); (groups[base] ??= { n: 0, amount: 0 }); groups[base].n++; groups[base].amount += pt.amount; });
          return Object.entries(groups).sort((a, b) => b[1].amount - a[1].amount).map(([base, g]) =>
            ({ day: u.day, kind: 'card', title: base + ' 결제', sub: g.n > 1 ? `${g.n}장 합쳐서 · 이번 달 청구` : '이번 달 청구', amount: g.amount }));
        }),
        needBy: h.needBy,
        debts: h.debts.map(d => ({ name: d.name, total: d.total, paid: d.paid, done: d.doneMonth ? ymLabel(d.doneMonth) : '' })),
        loans: h.loans,
        savings: h.savings,
        held: { count: heldM.length, kind: Object.keys(kinds).sort((a, b) => kinds[b] - kinds[a])[0] || '배달', saved: sumAmt(heldM) },
        goalsSaved: (st.goals || []).filter(g => g.status === 'done').reduce((s, g) => s + (+g.monthly || 0), 0)
      };
    }
    return { live: true, C, ready, today, month, cards, categories, tx, incomes, fixed, plans, home, insights: [], heldYear: { count: heldY.length, saved: sumAmt(heldY) } };
  }
  if (LIVE) D = liveData();

  // ---------- 상태 ----------
  const S = {
    role: LIVE ? (API.token() ? API.role() : null) : store.get('role'),
    tab: store.get('tab') || 'home',
    month: D.month,
    login: null,           // 로그인 화면에서 고른 역할
    fixedOpen: false,
    tip: 0,                // 오늘 쓸 수 있는 돈 아래 추천 문구 순서
    hist: { method: 'all', cat: 'all', bad: false, q: '' },
    anaMode: 'bill',
    offline: false
  };
  const isOwner = () => S.role === 'owner';

  // ---------- 그리기 ----------
  function render() {
    if (!S.role) { $app.innerHTML = loginView(); return; }
    const waiting = LIVE && !API.loaded() && S.tab !== 'more';
    const body = waiting
      ? `<div class="card empty" role="status">${S.offline ? `인터넷 연결을 확인해 주세요.<br>연결되면 바로 불러와요.<br><button class="btn soft" data-act="retry" style="margin-top:14px">다시 시도</button>` : '구글 시트에서 불러오는 중…'}</div>`
      : { home: homeView, cal: calView, hist: histView, ana: anaView, more: moreView }[S.tab]();
    $app.innerHTML = headerView() + `<main class="wrap">${body}</main>` + tabbarView() +
      (isOwner() ? `<button class="fab" data-act="input">${ICON('plus')}입력</button>` : '');
  }

  function headerView() {
    const t = pd(D.today);
    const evening = new Date().getHours() >= 18;
    let sub = '';
    const pills = !LIVE ? '<span class="pill demo">예시 숫자</span>'
      : S.offline ? '<span class="pill demo">연결 안 됨</span>'
      : API.pendingCount() ? '<span class="pill demo">시트에 저장하는 중…</span>'
      : S.savedAt && Date.now() - S.savedAt < 5000 ? `<span class="pill ok">${ICON('check', 'sm')}저장 완료</span>` : '';
    if (S.tab === 'home') {
      sub = isOwner()
        ? `<div class="hdr-sub"><span>${t.getMonth() + 1}월 ${t.getDate()}일 (${WEEK[t.getDay()]}) · ${evening ? '오늘도 잘 맡았어요' : '오늘의 청지기 체크'}</span>${pills}</div>`
        : `<div class="hdr-sub"><span class="pill view">${ICON('eye', 'sm')}보기 전용</span>${pills}</div>`;
    } else if (pills && LIVE) sub = `<div class="hdr-sub"><span></span>${pills}</div>`;
    return `<header class="hdr wrap"><div class="hdr-row">
      <div class="brand"><h1>오병이어</h1><p>마음껏 나누며 사는 날을 꿈꾸며</p></div>
      <div class="month"><button data-act="month" data-k="-1" aria-label="이전 달">${ICON('left')}</button><b>${monthLabel(S.month)}</b><button data-act="month" data-k="1" aria-label="다음 달">${ICON('right')}</button></div>
    </div>${sub}</header>`;
  }

  function tabbarView() {
    const tabs = [['home', '홈', 'home'], ['cal', '달력', 'calendar'], ['hist', '내역', 'list'], ['ana', '분석', 'chart'], ['more', '더보기', 'more']];
    return `<nav class="tabbar" aria-label="화면"><div class="in">${tabs.map(([k, n, i]) =>
      `<button data-act="tab" data-tab="${k}" ${S.tab === k ? 'aria-current="page"' : ''}>${ICON(i)}${n}</button>`).join('')}</div></nav>`;
  }

  // ----- 홈 -----
  function envelopes(ym) {
    const tx = monthTx(ym);
    const today = pd(D.today);
    const mon = new Date(today); mon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    return D.plans.map(p => {
      const cats = p.cats || [p.category];
      const used = tx.filter(t => cats.includes(t.category)).reduce((s, t) => s + t.amount, 0);
      const e = { ...p, used, remain: p.amount - used, ratio: used / p.amount };
      if (p.weekly) {
        const wb = p.amount / mondaysIn(ym);
        const wUsed = tx.filter(t => cats.includes(t.category) && pd(t.date) >= mon && pd(t.date) <= sun).reduce((s, t) => s + t.amount, 0);
        e.weekRemain = wb - wUsed;
      }
      return e;
    });
  }
  const barState = r => r > 1 ? 'over' : r >= 0.8 ? 'warn' : 'good';

  // 오늘 쓸 수 있는 돈에서 조금 남겼을 때의 추천 문구. 여유 없을 땐 보여 주지 않음.
  function savingTips(H) {
    if (H.perDay < 5000) return [];
    const t = pd(D.today);
    const daysLeft = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() - t.getDate() + 1;
    const a = Math.max(1000, Math.floor(H.perDay * 0.2 / 1000) * 1000);   // 하루 쓸 돈의 20%쯤, 천 원 단위
    const month = a * daysLeft, year = a * 365;
    const won = n => n >= 10000 ? `${(n / 10000).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}만 원` : `${fmt(n)}원`;
    const tips = [
      { i: 'wallet', t: '저축하면', s: `하루 <b>${won(a)}</b>만 남겨 저축하면 이번 달 남은 ${daysLeft}일 동안 <b>${won(month)}</b>, 1년이면 약 <b>${won(year)}</b>이 모여요.` },
      { i: 'lock', t: '비상금으로', s: `이번 달 아낀 <b>${won(month)}</b>을 비상금 통장에 옮겨 두면, 갑자기 생기는 병원비·경조사비를 카드 대신 낼 수 있어요.` }
    ];
    const d = H.debts && H.debts[0];
    if (d) tips.push({ i: 'target', t: '먼저 갚으면', s: `아낀 <b>${won(month)}</b>을 ‘${esc(d.name)}’에 보태면 남은 금액이 <b>${won(d.total - d.paid - month)}</b>으로 줄어요.` });
    tips.push({ i: 'sparkle', t: '아이 통장에', s: `하루 <b>${won(a)}</b>씩 아이 통장에 적립하면 1년 뒤 <b>${won(year)}</b>, 한 아이 앞으로 작은 선물이 돼요.` });
    return tips;
  }

  // 시트는 연결됐지만 카드·수입 설정이 아직 없을 때
  function setupView() {
    const n = monthTx(D.month).length;
    return `<section class="card"><h2>시트와 연결됐어요</h2>
      <p style="margin:0 0 10px;font-size:14.5px;line-height:1.65">아직 카드·수입·고정지출 설정이 없어서 홈 숫자를 계산할 수 없어요.<br>
      <b>더보기 → 데이터 가져오기</b>로 지금 쓰는 가계부를 옮기면 숫자가 채워져요.</p>
      ${isOwner() ? `<button class="btn primary block" data-act="menu" data-k="import" style="margin-bottom:10px">${ICON('download', 'sm')}데이터 가져오기</button>` : ''}
      <p class="muted" style="margin:0;font-size:13px">지금 입력하는 내역은 구글 시트 ‘내역’ 탭에 바로 저장돼요 · 이번 달 기록 ${n}건</p></section>`;
  }

  // 대출 한 건씩 (대출 목록 창)
  function loanRows(list) {
    return list.map(L => {
      const r = L.total ? Math.min(1, L.paid / L.total) : 0;
      const interestOnly = !L.monthly;                     // 원금은 그대로, 이자만 내는 대출 (보험계약대출 등)
      const bits = [interestOnly ? '이자만 내는 중' : `${Math.round(r * 100)}% 갚았어요`];
      if (L.monthly) bits.push(`매달 ${fmt(L.monthly)}원${L.day ? ` (${L.day}일)` : ''}`);
      if (L.interestMonthly) bits.push(`이자 매달 ${fmt(L.interestMonthly)}원`);
      if (L.rate && interestOnly) bits.push(`연 ${L.rate}%`);
      if (L.end) bits.push(`${ymLabel(L.end)} 끝`);
      return `<div class="bar-row"><div class="top"><b>${esc(L.name)}</b><span class="r">${interestOnly ? '빌린 돈' : '남은 원금'} <strong class="num">${fmt(L.left)}</strong></span></div>
        ${interestOnly ? '' : `<div class="bar" role="img" aria-label="${Math.round(r * 100)}% 갚음"><i class="good" style="width:${r * 100}%"></i></div>`}
        <div class="sub">${bits.join(' · ')}</div></div>`;
    }).join('');
  }
  function openLoans() {
    const list = ((D.home && D.home.loans) || []).filter(L => L.kind !== 'car');   // 자동차 할부는 홈에 따로
    const left = list.reduce((s, L) => s + L.left, 0), monthly = list.reduce((s, L) => s + (L.monthly || 0) + (L.interestMonthly || 0), 0);
    openSheet('대출 목록', list.length ? `<div class="stack">
      <ul class="rows"><li><span>빌린 돈 합계</span><b class="num">${fmt(left)}원</b></li><li><span>이자 매달</span><b class="num">${fmt(monthly)}원</b></li></ul>
      <div class="bars">${loanRows(list)}</div>
      <p class="muted" style="margin:0;font-size:12.5px">매달 나가는 돈은 고정지출에 들어 있어서 정산에서 한 번만 빠져요.</p></div>`
      : '<p class="empty" style="margin:0">등록된 대출이 없어요.</p>');
  }

  function homeView() {
    if (LIVE && !D.ready) return setupView();
    if (S.month !== D.month) return LIVE
      ? `<div class="card empty">홈 숫자는 이번 달 기준이에요.<br>지난 달은 달력·내역에서 볼 수 있어요.</div>`
      : `<div class="card empty">예시 숫자는 ${monthLabel(D.month)}에만 있어요.<br>실제 데이터를 연결하면 달마다 보여 드려요.</div>`;
    const H = D.home;
    const st = H.perDay <= 0 ? 'tight' : H.perDay < 10000 ? 'warn' : 'good';
    const note = { good: '여유 있게 지내고 있어요', warn: '조금씩 아껴 쓰면 충분해요', tight: '오늘은 꼭 필요한 것만' }[st];
    const big = H.perDay > 0 ? `<small>하루</small>${fmt(H.perDay)}원` : '0원';
    const tips = savingTips(H);
    const tip = tips[S.tip % (tips.length || 1)];
    const tipBox = tip ? `<div class="tip" aria-live="polite">
        <div class="tip-h">${ICON(tip.i, 'sm')}<b>조금 남겨서 ${tip.t}?</b>
          ${tips.length > 1 ? `<button class="tip-next" data-act="tip" aria-label="다른 추천 보기">다른 추천 <span class="num">${S.tip % tips.length + 1}/${tips.length}</span></button>` : ''}</div>
        <p>${tip.s}</p></div>` : '';

    const flow = H.upcoming.map(u => `<li>
      <span class="dchip ${u.kind === 'pay' ? 'pay' : ''}"><b>${u.day}</b><span>일</span></span>
      <span class="what">${esc(u.title)}<small>${u.kind === 'pay' ? `바로 나가는 돈 ${fmt(u.outNow)}원 · 남는 돈 ${fmt(u.after)}원` : esc(u.sub)}</small></span>
      <span class="amt num ${u.kind === 'pay' ? 'pos' : ''}">${u.kind === 'pay' ? '+' : ''}${fmt(u.amount)}</span></li>`).join('');

    const env = envelopes(S.month).map(e => {
      const s = barState(e.ratio);
      const right = e.weekly
        ? `이번 주 남은 <strong class="num">${fmt(Math.max(0, e.weekRemain))}</strong>`
        : e.remain >= 0 ? `남은 <strong class="num">${fmt(e.remain)}</strong>` : `<strong class="num">${fmt(-e.remain)}</strong> 넘었어요`;
      return `<div class="bar-row"><div class="top"><b>${esc(e.name)}</b><span class="r ${e.remain < 0 ? 'over' : ''}">${right}</span></div>
        <div class="bar" role="img" aria-label="${esc(e.name)} ${Math.round(e.ratio * 100)}% 사용"><i class="${s}" style="width:${Math.min(100, e.ratio * 100)}%"></i></div>
        ${e.weekly ? `<div class="sub">이번 달 남은 ${fmt(e.remain)}원 · 한 주 ${fmt(e.amount / mondaysIn(S.month))}원</div>` : ''}</div>`;
    }).join('');

    const debts = H.debts.map(d => {
      const r = d.paid / d.total;
      return `<div class="bar-row"><div class="top"><b>${esc(d.name)}</b><span class="r">남은 <strong class="num">${fmt(d.total - d.paid)}</strong></span></div>
        <div class="bar" role="img" aria-label="${Math.round(r * 100)}% 갚음"><i class="good" style="width:${r * 100}%"></i></div>
        <div class="sub">${Math.round(r * 100)}% 갚았어요${d.done ? ` · ${d.done} 마무리 예정` : ''}</div></div>`;
    }).join('');

    // 대출 (자동차 할부·보험계약대출 등): 가족에게 갚는 돈(갚아가는 중)과 따로. 홈에는 한 줄, 자세한 건 대출 목록에서
    // 모으는 중 (주택청약 등): 입금 기록이 쌓이면 모은 돈·회차가 늘어남
    const md = s => s ? `${+s.slice(5, 7)}월 ${+s.slice(8, 10)}일` : '';
    const saves = (H.savings || []).map(s => `<div class="bar-row"><div class="top"><b>${esc(s.name)}</b><span class="r">모은 돈 <strong class="num pos">${fmt(s.total)}</strong></span></div>
        <div class="sub">${s.count}회차${s.last ? ` · 마지막 입금 ${md(s.last)}` : ` · ${md(s.lastBase)} 기준`}${s.monthly ? ` · 매달 ${fmt(s.monthly)}원씩 넣는 통장` : ''}</div></div>`).join('');

    // 자동차 할부는 따로 한 칸, 나머지 대출만 묶어서 한 줄
    const carList = (H.loans || []).filter(L => L.kind === 'car');
    const loanList = (H.loans || []).filter(L => L.kind !== 'car');
    const cars = loanRows(carList);
    const loanLeft = loanList.reduce((s, L) => s + L.left, 0);
    const loanMonthly = loanList.reduce((s, L) => s + (L.monthly || 0) + (L.interestMonthly || 0), 0);
    const loans = loanList.length;

    const fixedTotal = D.fixed.reduce((s, f) => s + f.amount, 0);
    const fixedList = S.fixedOpen ? `<div class="fold"><ul class="rows">${D.fixed.map(f => `<li><span>${esc(f.name)}<small>${f.day}일 · ${cardOf(f.method).name}${f.pct ? ` · 급여 ${f.pct}%` : ''}${f.perWeek ? ` · 주 ${fmt(f.perWeek)}원 × ${mondaysIn(S.month)}주` : ''}</small></span><b class="num">${fmt(f.amount)}</b></li>`).join('')}</ul></div>` : '';

    return `
    <section class="card today" aria-label="오늘 쓸 수 있는 돈">
      <div class="label">오늘 쓸 수 있는 돈</div>
      <div class="big num st-${st}">${big}</div>
      <div class="sub">이번 달 남은 돈 <b class="num">${fmt(H.monthLeft)}원</b></div>
      <span class="note ${st}">${note}</span>
      ${tipBox}
    </section>
    <div class="duo">
      <section class="card"><div class="label">이번 달 정산</div><div class="v num ${H.settleThis < 0 ? 'neg' : 'pos'}">${signed(H.settleThis)}</div>
        <div class="hint muted">${H.settleThis < 0 ? `예상 적자 ${fmt(-H.settleThis)}원` : '이번 달 남는 돈'}</div></section>
      <section class="card navy"><div class="label">다음 달 정산 예상</div><div class="v num ${H.settleNext < 0 ? 'neg' : 'pos'}">${signed(H.settleNext)}</div>
        <div class="hint">이번 달 카드 사용분 포함</div></section>
    </div>
    ${flow ? `<section class="card" id="upcoming"><h2>다가오는 결제 <small>날짜순</small></h2><ul class="flow">${flow}</ul>
      ${H.needBy ? `<div class="need">${H.needBy.day}일까지 통장에 <b class="num">${fmt(H.needBy.amount)}원</b>이 필요해요</div>` : ''}</section>` : ''}
    ${env ? `<section class="card"><h2>이번 달 예산 <small>${monthLabel(S.month)}</small></h2><div class="bars">${env}</div>
      ${LIVE && isOwner() ? `<button class="btn soft block" data-act="shop" style="margin-top:12px">${ICON('cart', 'sm')}장보기 모드</button>` : ''}</section>` : ''}
    <section class="card"><h2>참았어요</h2><div class="hold">
      <p>이번 달 참은 ${H.held.kind} <b>${H.held.count}번</b> · 약 <b class="num">${fmt(H.held.saved)}원</b> 아꼈어요</p>
      ${isOwner() ? `<button class="btn soft" data-act="held">${ICON('hand', 'sm')}참았어요</button>` : ''}</div></section>
    ${saves ? `<section class="card"><h2>모으는 중 <small>입금은 [+ 입력]에 사용처 ‘청약’으로</small></h2><div class="bars">${saves}</div></section>` : ''}
    ${debts ? `<section class="card"><h2>갚아가는 중</h2><div class="bars">${debts}</div></section>` : ''}
    ${cars ? `<section class="card"><h2>자동차</h2><div class="bars">${cars}</div></section>` : ''}
    ${loans ? `<section class="card" style="padding-top:8px;padding-bottom:8px">
      <button class="linkrow" data-act="loans"><span>대출 ${loans}건 · 빌린 돈 <b class="num">${fmt(loanLeft)}원</b><small class="muted" style="display:block;font-size:12.5px">이자 매달 ${fmt(loanMonthly)}원</small></span>${ICON('right', 'sm')}</button></section>` : ''}
    <section class="card" style="padding-top:8px;padding-bottom:8px">
      <button class="linkrow" data-act="fixed" aria-expanded="${S.fixedOpen}"><span>고정지출 <b class="num">${fmt(fixedTotal)}원</b> <span class="muted">(자동)</span></span>${ICON(S.fixedOpen ? 'down' : 'right', 'sm')}</button>${fixedList}</section>
    ${H.goalsSaved ? `<p class="saved-goal">줄이기 목표로 매달 ${fmt(H.goalsSaved)}원 줄였어요</p>` : ''}`;
  }

  // ----- 달력 -----
  function calView() {
    const [y, m] = S.month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
    const tx = monthTx(S.month);
    const total = tx.reduce((s, t) => s + t.amount, 0);
    const inc = (D.incomes || []).filter(t => t.date.startsWith(S.month));          // 들어온 돈
    const incTotal = inc.reduce((s, t) => s + t.amount, 0);
    const days = new Date(y, m, 0).getDate();
    const head = ['월', '화', '수', '목', '금', '토', '일'].map(w => `<div class="dow ${w === '일' ? 'sun' : ''}">${w}</div>`).join('') + '<div class="dow wk">주 합계</div>';
    let cells = '';
    const d = new Date(start);
    while (true) {
      let wsum = 0;
      for (let i = 0; i < 7; i++) {
        const key = ymd(d), inM = d.getMonth() === m - 1;
        const dt = inM ? tx.filter(t => t.date === key) : [];
        const sum = dt.reduce((s, t) => s + t.amount, 0); wsum += sum;
        const inSum = inM ? inc.filter(t => t.date === key).reduce((s, t) => s + t.amount, 0) : 0;
        const dots = [...new Set(dt.map(t => t.method))].map(id => `<i style="background:${cardOf(id).color}"></i>`).join('');
        const fx = '';                                  // 고정지출 날 표시는 달력이 복잡해 보여서 뺌 (11/11 사용자 요청)
        cells += inM
          ? `<button class="cell ${key === D.today ? 'today' : ''} ${d.getDay() === 0 ? 'sun' : ''}" data-act="day" data-date="${key}" aria-label="${d.getDate()}일 ${sum ? '쓴 돈 ' + fmt(sum) + '원' : ''}${inSum ? ' 들어온 돈 ' + fmt(inSum) + '원' : ''}${!sum && !inSum ? '기록 없음' : ''}">
              <span class="d">${d.getDate()}</span><span class="s num">${sum ? man(sum) : ''}</span>${inSum ? `<span class="in num">+${man(inSum)}</span>` : ''}<span class="dots">${dots}</span>${fx}</button>`
          : `<div class="cell out"><span class="d">${d.getDate()}</span></div>`;
        d.setDate(d.getDate() + 1);
      }
      cells += `<div class="wkcell num">${wsum ? man(wsum) : '–'}</div>`;
      if (d.getMonth() !== m - 1 || d.getDate() > days) break;
    }
    const legend = D.cards.map(c => `<span><i class="dot" style="background:${c.color}"></i>${c.name}</span>`).join('');
    const daysSoFar = S.month === D.month ? pd(D.today).getDate() : days;
    return `
    <div class="duo">
      <section class="card"><div class="label">${monthLabel(S.month)} 쓴 돈</div>
        <div class="v num">${fmt(total)}원</div>
        <div class="hint muted">하루 평균 ${fmt(total / daysSoFar)}원</div></section>
      <section class="card"><div class="label">들어온 돈 <small>(월급 빼고)</small></div>
        <div class="v num pos">+${fmt(incTotal)}원</div>
        <div class="hint muted">${inc.length}건</div></section>
    </div>
    <section class="card" style="padding:14px 10px"><div class="cal">${head}${cells}</div><div class="legend" style="padding:0 6px">${legend}</div></section>`;
  }

  function openDay(date) {
    const t = pd(date);
    const list = D.tx.filter(x => x.date === date);
    const sum = list.reduce((s, x) => s + x.amount, 0);
    const ins = (D.incomes || []).filter(x => x.date === date), inSum = ins.reduce((s, x) => s + x.amount, 0);
    openSheet(`${t.getMonth() + 1}월 ${t.getDate()}일 (${WEEK[t.getDay()]})`,
      `<div class="stack"><div class="muted">이날 쓴 돈 <b class="num" style="color:var(--text)">${fmt(sum)}원</b>${inSum ? ` · 들어온 돈 <b class="num pos">+${fmt(inSum)}원</b>` : ''}</div>
      ${ins.length ? `<ul class="txlist">${ins.map(incomeRow).join('')}</ul>` : ''}
      ${list.length ? `<ul class="txlist">${list.map(txRow).join('')}</ul>` : (ins.length ? '' : '<p class="empty">이날은 기록이 없어요.</p>')}
      ${isOwner() ? `<button class="btn primary block" data-act="input" data-date="${date}">${ICON('plus', 'sm')}이 날짜로 입력</button>` : ''}</div>`);
  }

  // ----- 내역 -----
  function txRow(t) {
    const c = cardOf(t.method);
    const tags = [
      t.months > 1 ? `<span class="tag">${t.months}개월 할부</span>` : '',
      t.isFixed ? '<span class="tag fix">고정</span>' : '',
      t.unneeded ? '<span class="tag bad">불필요</span>' : ''
    ].join('');
    return `<li><button class="tx" data-act="tx" data-id="${t.id}">
      <span class="cat-ic">${esc(t.category.slice(0, 1))}</span>
      <span class="mid"><span class="memo">${esc(t.memo)}</span>
        <span class="meta"><i class="dot" style="background:${c.color}"></i>${c.name} · ${esc(t.category)} ${tags}</span></span>
      <span class="amt num">${fmt(t.amount)}${t.months > 1 ? `<small>월 ${fmt(Math.floor(t.amount / t.months / 100) * 100)}</small>` : ''}</span>
    </button></li>`;
  }

  const incomeRow = t => `<li><button class="tx" data-act="tx" data-id="${t.id}"><span class="cat-ic in">+</span><span class="mid"><span class="memo">${esc(t.memo)}</span><span class="meta">${+t.date.slice(5, 7)}/${+t.date.slice(8)} · ${esc(t.category)}</span></span><span class="amt num pos">+${fmt(t.amount)}</span></button></li>`;

  function histView() {
    const H = S.hist;
    let list = monthTx(S.month);
    if (H.method !== 'all') list = list.filter(t => t.method === H.method);
    if (H.cat !== 'all') list = list.filter(t => t.category === H.cat);
    if (H.bad) list = list.filter(t => t.unneeded);
    if (H.q) list = list.filter(t => (t.memo + t.category).includes(H.q));
    list.sort((a, b) => b.date.localeCompare(a.date));
    const groups = {};
    list.forEach(t => (groups[t.date] = groups[t.date] || []).push(t));
    const total = list.reduce((s, t) => s + t.amount, 0);
    const mChips = [['all', '전체'], ...D.cards.map(c => [c.id, c.name])].map(([k, n]) =>
      `<button class="chip" data-act="hf" data-k="method" data-v="${k}" aria-pressed="${H.method === k}">${k !== 'all' ? `<i class="dot" style="background:${cardOf(k).color}"></i>` : ''}${n}</button>`).join('');
    const cChips = [['all', '모든 분류'], ...D.categories.map(c => [c, c])].map(([k, n]) =>
      `<button class="chip" data-act="hf" data-k="cat" data-v="${esc(k)}" aria-pressed="${H.cat === k}">${esc(n)}</button>`).join('');
    const body = Object.keys(groups).length ? Object.entries(groups).map(([d, arr]) => {
      const t = pd(d);
      return `<section class="card" style="padding:10px 18px 4px"><div class="dayhead"><span>${t.getMonth() + 1}월 ${t.getDate()}일 (${WEEK[t.getDay()]})</span><span class="num">${fmt(arr.reduce((s, x) => s + x.amount, 0))}원</span></div>
        <ul class="txlist">${arr.map(txRow).join('')}</ul></section>`;
    }).join('') : `<div class="card empty">조건에 맞는 기록이 없어요.</div>`;
    const ins = (D.incomes || []).filter(t => t.date.startsWith(S.month)).sort((a, b) => b.date.localeCompare(a.date));
    const inHtml = ins.length ? `<section class="card" style="padding:10px 18px 4px"><div class="dayhead"><span>들어온 돈 ${ins.length}건</span><span class="num pos">+${fmt(ins.reduce((s, x) => s + x.amount, 0))}원</span></div>
      <ul class="txlist">${ins.map(incomeRow).join('')}</ul></section>` : '';
    return `
    ${inHtml}
    <label class="search">${ICON('search', 'sm')}<input id="hq" type="search" placeholder="사용처 찾기" value="${esc(H.q)}" aria-label="사용처 찾기"></label>
    <div class="chips scroll">${mChips}</div>
    <div class="chips scroll">${cChips}</div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span class="muted" style="font-size:14px">${list.length}건 · <b class="num" style="color:var(--text)">${fmt(total)}원</b></span>
      <button class="chip" data-act="hf" data-k="bad" aria-pressed="${H.bad}">불필요만</button></div>
    ${body}`;
  }

  // ----- 분석 -----
  function anaView() {
    if (LIVE && D.ready && D.C) return anaLive();
    const tx = monthTx(S.month);
    const by = {};
    if (S.anaMode === 'bill') {
      tx.forEach(t => { const a = t.months > 1 ? Math.floor(t.amount / t.months / 100) * 100 + (t.amount - Math.floor(t.amount / t.months / 100) * 100 * t.months) : t.amount; by[t.category] = (by[t.category] || 0) + a; });
      by['고정지출'] = D.fixed.reduce((s, f) => s + f.amount, 0);
    } else {
      tx.forEach(t => { by[t.category] = (by[t.category] || 0) + t.amount; });
    }
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
    const total = rows.reduce((s, r) => s + r[1], 0) || 1;
    const max = rows.length ? rows[0][1] : 1;
    const bars = rows.length ? rows.map(([k, v]) => `<div class="bar-row"><div class="top"><b>${esc(k)}</b><span class="r"><strong class="num">${fmt(v)}</strong> · ${Math.round(v / total * 100)}%</span></div>
      <div class="bar"><i style="width:${v / max * 100}%"></i></div></div>`).join('') : '<p class="empty">이 달은 기록이 없어요.</p>';
    const ins = D.insights.map(i => `<div class="insight"><span class="ic ${i.good ? '' : 'n'}">${ICON(i.icon, 'sm')}</span><p>${i.text}</p></div>`).join('');
    const H = D.home ? D.home.held : { kind: '배달', count: 0 };
    const HY = D.heldYear;
    return `
    <div class="seg" role="group" aria-label="기준">
      <button data-act="ana" data-v="bill" aria-pressed="${S.anaMode === 'bill'}">나가는 돈 기준</button>
      <button data-act="ana" data-v="use" aria-pressed="${S.anaMode === 'use'}">쓴 돈 기준</button></div>
    <section class="card"><h2>분류별 <small>${S.anaMode === 'bill' ? '할부는 이번 달 회차만 · 고정 포함' : '이번 달에 쓴 금액 전체'}</small></h2>
      <div class="num" style="font-size:26px;font-weight:800;margin:-4px 0 12px">${fmt(total)}원</div><div class="bars">${bars}</div></section>
    ${ins ? `<section class="card"><h2>이번 달 살펴보기</h2><div class="stack" style="gap:14px">${ins}</div></section>` : ''}
    <section class="card"><h2>참았어요 누적</h2><p style="margin:0;font-size:14px">올해 참은 횟수 <b class="num">${fmt(HY.count)}번</b> · 약 <b class="num pos">${fmt(HY.saved)}원</b> 아꼈어요</p>
      <p class="muted" style="margin:6px 0 0;font-size:12.5px">이번 달은 ${H.kind} ${H.count}번이에요.</p></section>`;
  }

  // 실제 데이터 분석 (명세서 4-8): Calc.analyze·insights + 6개월 흐름 + 분류 누르면 그 내역
  const INS_IC = { up: 'trend', rep: 'repeat', bad: 'sparkle' };
  function anaLive() {
    const C = D.C, M = S.month, basis = S.anaMode;
    const A = C.analyze(M, basis);
    const pct = v => A.total ? Math.round(v / A.total * 100) : 0;
    const max = A.cats.length ? A.cc[A.cats[0]] : 1;
    const bars = A.cats.length ? A.cats.map(k => {
      const v = A.cc[k], av = A.avg[k];
      const cmp = A.prevMs.length && av > 0 && Math.abs(v - av) >= 10000
        ? `<span class="cmp ${v > av ? 'up' : 'down'}">평소보다 ${v > av ? '+' : '−'}${fmt(Math.abs(v - av))}</span>` : '';
      return `<button class="bar-row ana-row" data-act="anacat" data-cat="${esc(k)}"><div class="top"><b>${esc(k)} <small class="muted">${A.cnt[k]}건</small></b><span class="r"><strong class="num">${fmt(v)}</strong> · ${pct(v)}%</span></div>
        <div class="bar"><i style="width:${v / max * 100}%"></i></div>${cmp ? `<div class="sub">${cmp}</div>` : ''}</button>`;
    }).join('') : '<p class="empty">이 달은 기록이 없어요.</p>';
    // 최근 6개월 흐름
    const months = [5, 4, 3, 2, 1, 0].map(k => addMonth(M, -k));
    // 기록이 15건 안 되는 달은 숫자가 작게 보여 오해하기 쉬워서 '기록 적음'으로만
    const tot = months.map(m => { const a = m === M ? A : C.analyze(m, basis); return { m, v: a.total, few: m !== M && a.items.filter(i => !i.virtual).length < 15 }; });
    const tmax = Math.max(1, ...tot.filter(x => !x.few).map(x => x.v));
    const trend = `<div class="trend">${tot.map(x => `<div class="tcol ${x.m === M ? 'on' : ''} ${x.few ? 'few' : ''}"><span class="tv num">${x.few ? '기록<br>적음' : x.v ? man(x.v) : ''}</span><i style="height:${x.few ? 2 : Math.max(2, x.v / tmax * 100)}%"></i><span class="tm">${Number(x.m.slice(5))}월</span></div>`).join('')}</div>`;
    const ins = C.insights(A, M).sort((a, b) => b.amt - a.amt).map(i => `<div class="insight"><span class="ic ${i.cls === 'bad' ? 'bad' : i.cls === 'up' ? 'up' : 'n'}">${ICON(INS_IC[i.cls] || 'sparkle', 'sm')}</span>
      <div class="ins-b"><div class="ins-h"><b>${esc(i.k)}</b><span class="num">${fmt(i.amt)}원</span></div><div class="ins-t">${i.html}</div></div></div>`).join('');
    const H = D.home ? D.home.held : { kind: '배달', count: 0 };
    const HY = D.heldYear;
    return `
    <div class="seg" role="group" aria-label="기준">
      <button data-act="ana" data-v="bill" aria-pressed="${basis === 'bill'}">나가는 돈 기준</button>
      <button data-act="ana" data-v="use" aria-pressed="${basis === 'use'}">쓴 돈 기준</button></div>
    <section class="card"><h2>${monthLabel(M)} <small>${basis === 'bill' ? '이 달 통장에서 나가는 돈 · 할부는 회차만 · 고정 포함' : '이 달에 쓴 돈 · 할부는 전체 금액'}</small></h2>
      <div class="num" style="font-size:28px;font-weight:800;margin:-2px 0 10px">${fmt(A.total)}원</div>
      <div class="split"><div><small>꼭 필요한 돈</small><b class="num">${fmt(A.need)}</b><span>${pct(A.need)}%</span></div><div><small>줄일 수 있는 돈</small><b class="num">${fmt(A.want)}</b><span>${pct(A.want)}%</span></div></div>
      <ul class="rows" style="margin-top:8px"><li><span>카드</span><b class="num">${fmt(A.card)}</b></li><li><span>현금·이체</span><b class="num">${fmt(A.cash)}</b></li>
        ${A.fixed ? `<li><span>그중 고정지출</span><b class="num">${fmt(A.fixed)}</b></li>` : ''}${A.inst ? `<li><span>그중 할부</span><b class="num">${fmt(A.inst)}</b></li>` : ''}</ul></section>
    <section class="card"><h2>최근 6개월 <small>${basis === 'bill' ? '나가는 돈' : '쓴 돈'}</small></h2>${trend}</section>
    ${ins ? `<section class="card"><h2>이번 달 살펴보기 <small>금액 큰 순</small></h2><div class="stack" style="gap:16px">${ins}</div></section>` : ''}
    <section class="card"><h2>분류별 <small>${A.prevMs.length ? `누르면 내역 · 비교는 최근 ${A.prevMs.length}개월 평균` : '누르면 내역'}</small></h2><div class="bars">${bars}</div></section>
    <section class="card"><h2>참았어요 누적</h2><p style="margin:0;font-size:14px">올해 참은 횟수 <b class="num">${fmt(HY.count)}번</b> · 약 <b class="num pos">${fmt(HY.saved)}원</b> 아꼈어요</p>
      <p class="muted" style="margin:6px 0 0;font-size:12.5px">이번 달은 ${H.kind} ${H.count}번이에요.</p></section>`;
  }
  function openAnaCat(cat) {
    const A = D.C.analyze(S.month, S.anaMode);
    const list = A.items.filter(i => i.category === cat).sort((a, b) => b.amount - a.amount);
    const rows = list.map(i => {
      const tag = [i.fixed ? '고정' : '', i.inst && i.inst.k ? `할부 ${i.inst.k}/${i.inst.n}` : i.inst ? `${i.inst.n}개월 할부` : '', i.t ? i.t.date.slice(5).replace('-', '/') : '예상'].filter(Boolean).join(' · ');
      return `<li>${i.t ? `<button class="ana-tx" data-act="tx" data-id="${esc(i.t.id)}">` : '<div class="ana-tx">'}<span><b>${esc(i.memo)}</b><small>${cardOf(i.method).name} · ${tag}</small></span><b class="num">${fmt(i.amount)}</b>${i.t ? '</button>' : '</div>'}</li>`;
    }).join('');
    openSheet(`${cat} · ${monthLabel(S.month)}`, `<div class="stack"><div class="set-sum">${list.length}건 <b class="num">${fmt(list.reduce((s, i) => s + i.amount, 0))}원</b></div><ul class="set-list ana-list">${rows}</ul></div>`, null, 'wide');
  }

  // ----- 더보기 -----
  const MENU = [
    { k: 'shop', i: 'cart', t: '장보기 모드', s: '장바구니 계산기 · 이번 주 남은 금액', step: 7, owner: true },
    { k: 'held', i: 'hand', t: '참았어요 기록', s: '참은 배달·외식 모아 보기', step: 7 },
    { k: 'loans', i: 'wallet', t: '대출 목록', s: '주택청약·보험계약대출 · 빌린 돈과 이자' },
    { k: 'goal', i: 'target', t: '줄이기 목표', s: '요금제 점검 같은 할 일 목록', step: 7 },
    { k: 'upload', i: 'upload', t: '명세서 올리기', s: '카드 명세서 파일로 내역 채우기', step: 6, owner: true },
    { k: 'set', i: 'settings', t: '설정', s: '카드 · 수입 · 고정지출 · 예산 · 분류', step: 5, owner: true },
    { k: 'import', i: 'download', t: '데이터 가져오기', s: '지금 쓰는 가계부 파일 옮기기', step: 5, owner: true },
    { k: 'noti', i: 'bell', t: '알림', s: '퇴근 무렵 · 주말 · 결제일 · 일요일 점검', step: 9, owner: true }
  ];
  function moreView() {
    const items = MENU.filter(m => isOwner() || !m.owner).map(m =>
      `<li><button data-act="menu" data-k="${m.k}"><span class="mi">${ICON(m.i)}</span><span class="tt"><b>${m.t}</b><small>${m.s}</small></span>${ICON('right', 'sm')}</button></li>`).join('');
    return `
    <section class="card" style="padding-top:4px;padding-bottom:4px"><ul class="menu">${items}</ul></section>
    <section class="card" style="padding-top:4px;padding-bottom:4px"><ul class="menu">
      ${LIVE ? '' : `<li><button data-act="switch"><span class="mi">${ICON(isOwner() ? 'eye' : 'lock')}</span><span class="tt"><b>${isOwner() ? '함께 보기 화면 미리 보기' : '청지기 화면으로 돌아가기'}</b><small>예시 화면에서만 있는 버튼이에요</small></span></button></li>`}
      <li><button data-act="logout"><span class="mi">${ICON('logout')}</span><span class="tt"><b>나가기</b><small>이 기기에서 로그아웃</small></span></button></li>
    </ul></section>
    <p class="footer-note">작은 것을 드렸더니 넉넉해졌습니다 — 오병이어</p>`;
  }

  // ----- 로그인 -----
  function loginView() {
    const L = S.login;
    const inner = !L ? `
      <div class="btns">
        <button class="btn gold" data-act="pick" data-role="owner">청지기로 들어가기</button>
        <button class="btn line" data-act="pick" data-role="viewer">함께 보기</button>
      </div>` : `
      <form class="btns" id="loginForm">
        <div class="who">${L === 'owner' ? '청지기' : '함께 보기'} 비밀번호</div>
        <input class="inp" id="pw" type="password" autocomplete="current-password" placeholder="비밀번호" aria-label="비밀번호">
        <button class="btn gold" type="submit">들어가기</button>
        ${LIVE ? '' : '<p class="small">예시 화면이라 아무 글자나 넣으면 들어가져요.</p>'}
        <button class="back" type="button" data-act="pick" data-role="">다른 쪽으로 들어가기</button>
      </form>`;
    return `<div class="login wrap"><div class="in">
      <div><img class="logo" src="icons/icon-192.png" alt=""><h1>오병이어</h1><p class="tag-line">마음껏 나누며 사는 날을 꿈꾸며</p></div>
      ${inner}</div></div>`;
  }

  // ---------- 아래에서 올라오는 창 ----------
  // 창이 열리면 읽기 도구·키보드 초점을 창으로 옮기고, 닫으면 누른 버튼으로 돌려놓는다
  let sheetEl = null, sheetFrom = null;
  function openSheet(title, html, mount, cls) {
    if (!sheetEl) sheetFrom = document.activeElement;
    closeSheet(true);
    sheetEl = document.createElement('div');
    sheetEl.className = 'scrim';
    sheetEl.innerHTML = `<div class="sheet wrap ${cls || ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><div class="grip"></div>
      <div class="sheet-h"><h3>${esc(title)}</h3><button class="iconbtn" data-act="close" aria-label="닫기">${ICON('x')}</button></div>${html}</div>`;
    sheetEl.addEventListener('click', e => { if (e.target === sheetEl) closeSheet(); });
    document.body.appendChild(sheetEl);
    document.body.classList.add('sheet-open');
    const box = sheetEl.querySelector('.sheet');
    if (mount) mount(box);
    if (!box.contains(document.activeElement)) box.focus({ preventScroll: true });
  }
  function closeSheet(keepFocus) {
    if (!sheetEl) return;
    sheetEl.remove(); sheetEl = null;
    if (keepFocus === true) return;
    document.body.classList.remove('sheet-open');
    if (sheetFrom && document.contains(sheetFrom)) sheetFrom.focus({ preventScroll: true });
    sheetFrom = null;
  }
  // 창이 열려 있으면 Tab 키가 창 안에서만 돈다
  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !sheetEl) return;
    const f = [...sheetEl.querySelectorAll('button,input,select,textarea,a[href],[tabindex="0"]')].filter(x => !x.disabled && x.offsetParent);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && (document.activeElement === first || !sheetEl.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  let toastT = null;
  function toast(msg, ms) {
    let el = document.querySelector('.toast');
    if (!el) { el = document.createElement('div'); el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; clearTimeout(toastT); toastT = setTimeout(() => el.remove(), ms || 2200);
  }

  // ---------- 빠른 입력 ----------
  function memoHistory() {
    const m = new Map();
    [...D.tx].sort((a, b) => b.date.localeCompare(a.date)).forEach(t => { if (!m.has(t.memo)) m.set(t.memo, t); });
    return [...m.values()].slice(0, 8);
  }
  function openInput(pre) {
    const edit = pre && pre.id;
    const INC_CATS = ['부수입', '용돈·선물', '환급·캐시백', '기타 수입'];
    const f = Object.assign({ inc: !!(pre && pre.source === 'income'),
      amount: '', memo: '', method: D.cards[0] ? D.cards[0].id : 'cash',
      // 실제 화면에서는 분류를 미리 고르지 않음(장보기로 잘못 들어가 예산이 줄던 문제) — 예전 사용처면 자동
      category: LIVE ? (D.categories.includes('기타') ? '기타' : D.categories[0]) : (D.categories.includes('장보기') ? '장보기' : D.categories[0]), months: 1, date: D.today, unneeded: false
    }, pre || {});
    const draw = el => {
      const hist = f.inc ? [...new Map((D.incomes || []).map(t => [t.memo, t])).values()].slice(0, 8) : memoHistory();
      el.querySelector('#fx').innerHTML = `
        ${LIVE && !edit ? `<div class="seg" role="group" aria-label="종류"><button data-act="fset" data-k="inc" data-v="0" aria-pressed="${!f.inc}">나간 돈</button><button data-act="fset" data-k="inc" data-v="1" aria-pressed="${f.inc}">들어온 돈</button></div>` : ''}
        <div class="amount-in ${f.inc ? 'plus' : ''}"><input id="inAmt" inputmode="numeric" autocomplete="off" placeholder="0" value="${f.amount ? fmt(f.amount) : ''}" aria-label="금액"><span>원</span></div>
        <label class="field"><span>${f.inc ? '어디서 받았나요' : '사용처'}</span><input class="inp" id="inMemo" autocomplete="off" placeholder="${f.inc ? '예: 중고 판매, 용돈' : '예: 동네마트'}" value="${esc(f.memo)}"></label>
        ${!edit ? `<div class="chips scroll">${hist.map(t => `<button class="chip" data-act="pickmemo" data-id="${t.id}">${esc(t.memo)}</button>`).join('')}</div>` : ''}
        ${f.inc ? `<div class="field"><span>분류</span><div class="chips scroll">${INC_CATS.map(c => `<button class="chip" data-act="fset" data-k="category" data-v="${c}" aria-pressed="${f.category === c}">${c}</button>`).join('')}</div></div>` : `<div class="field"><span>결제</span><div class="chips">${D.cards.map(c => `<button class="chip" data-act="fset" data-k="method" data-v="${c.id}" aria-pressed="${f.method === c.id}"><i class="dot" style="background:${c.color}"></i>${c.name}</button>`).join('')}</div></div>
        <div class="field"><span>분류 <small class="muted">(예전 사용처면 자동)</small></span><div class="chips scroll">${D.categories.map(c => `<button class="chip" data-act="fset" data-k="category" data-v="${c}" aria-pressed="${f.category === c}">${c}</button>`).join('')}</div></div>
`}
        ${f.inc ? '' : f.method !== 'cash' ? `<div class="field"><span>할부</span><div class="chips scroll">${[1, 2, 3, 4, 5, 6, 10, 12].map(n => `<button class="chip" data-act="fset" data-k="months" data-v="${n}" aria-pressed="${f.months === n}">${n === 1 ? '일시불' : n + '개월'}</button>`).join('')}</div></div>` : ''}
        <div class="row2"><label class="field"><span>날짜</span><input class="inp" id="inDate" type="date" value="${f.date}"></label>
          ${f.inc ? '<span></span>' : `<label class="field"><span>불필요한 지출</span><span class="toggle" style="min-height:48px"><span class="muted" style="font-size:14px">표시</span><input class="switch" id="inBad" type="checkbox" ${f.unneeded ? 'checked' : ''}></span></label>`}</div>
        <div class="stack" style="gap:10px">
          <button class="btn primary block" data-act="save" style="min-height:52px">${edit ? '고친 내용 저장' : '저장'}</button>
          ${edit ? `<button class="btn danger block" data-act="del">지우기</button>` : `<button class="btn block" data-act="save" data-more="1">저장하고 계속 입력</button>`}
        </div>`;
      const a = el.querySelector('#inAmt');
      a.addEventListener('input', () => { const n = Number(a.value.replace(/[^\d]/g, '')); f.amount = n; a.value = n ? fmt(n) : ''; });
      el.querySelector('#inMemo').addEventListener('input', e => { f.memo = e.target.value; });
      el.querySelector('#inDate').addEventListener('change', e => { f.date = e.target.value; });
      const bad = el.querySelector('#inBad'); if (bad) bad.addEventListener('change', e => { f.unneeded = e.target.checked; });
      if (!edit && !f.amount) setTimeout(() => a.focus(), 50);
    };
    openSheet(edit ? '기록 고치기' : '입력', `<div class="stack" id="fx"></div>`, el => {
      draw(el);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-act]'); if (!b) return;
        const act = b.dataset.act;
        if (act === 'fset' && b.dataset.k === 'inc') { f.inc = b.dataset.v === '1'; f.category = f.inc ? INC_CATS[0] : (D.categories.includes('장보기') ? '장보기' : D.categories[0]); draw(el); return; }
        if (act === 'fset') { const v = b.dataset.k === 'months' ? Number(b.dataset.v) : b.dataset.v; f[b.dataset.k] = v; if (b.dataset.k === 'method' && v === 'cash') f.months = 1; draw(el); }
        if (act === 'pickmemo') { const t = [...D.tx, ...(D.incomes || [])].find(x => x.id === b.dataset.id); Object.assign(f, { memo: t.memo, method: t.method, category: t.category }); draw(el); }
        if (act === 'save') {
          if (!f.amount) { toast('금액을 넣어 주세요'); return; }
          if (!f.memo.trim()) { toast(f.inc ? '어디서 받았는지 넣어 주세요' : '사용처를 넣어 주세요'); return; }
          // 모으는 통장(주택청약 등) 이름이 사용처에 들어 있으면 저축 분류로 (적립금에 더해지게)
          const sv = LIVE ? (API.settings().savings || []).find(s => s.match && f.memo.includes(s.match)) : null;
          if (sv && D.categories.includes('저축·상환') && !/저축|적금|상환/.test(f.category)) f.category = '저축·상환';
          if (LIVE) {
            const old = edit ? [...D.tx, ...(D.incomes || [])].find(x => x.id === f.id) : null;
            const now = Date.now();
            const row = {
              ...(old || {}), id: edit ? f.id : 't' + now.toString(36) + Math.random().toString(36).slice(2, 6),
              date: f.date, amount: f.amount, method: f.inc ? 'cash' : f.method, category: f.category, memo: f.memo.trim(),
              months: f.inc || f.method === 'cash' ? 1 : f.months, unneeded: !f.inc && !!f.unneeded, isFixed: !!(old && old.isFixed),
              source: f.inc ? 'income' : ((old && old.source !== 'income' && old.source) || 'manual'), createdAt: (old && old.createdAt) || now
            };
            // 고정지출(피아노·태권도 등)을 직접 입력했으면 그 고정지출과 맞춤 → 이번 달 예상분 대신 이 금액 (두 번 빠지지 않게)
            if (!f.inc && !row.fixedId) {
              const fx = linkFixed(row);
              if (fx) { row.isFixed = true; row.fixedId = fx.id; if (fx.category && D.categories.includes(fx.category)) row.category = fx.category; toast(`고정지출 ‘${fx.name}’과 맞췄어요. 이번 달은 이 금액으로 계산해요`, 3500); }
            }
            API.write('내역', row.id, row);
          } else if (edit) Object.assign(D.tx.find(x => x.id === f.id), f);
          else D.tx.push({ ...f, id: 'n' + Date.now(), memo: f.memo.trim(), isFixed: false });
          toast(edit ? '고쳤어요' : LIVE ? (f.inc ? '들어온 돈을 저장했어요' : '저장했어요') : '저장했어요 (예시 화면이라 새로고침하면 사라져요)');
          if (b.dataset.more) { f.amount = ''; f.memo = ''; f.unneeded = false; draw(el); }
          else { closeSheet(); render(); }
        }
        if (act === 'del') {
          if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = '한 번 더 누르면 지워져요'; return; }
          if (LIVE) API.remove('내역', f.id);
          else D.tx.splice(D.tx.findIndex(x => x.id === f.id), 1);
          closeSheet(); render(); toast('지웠어요');
        }
      });
    });
  }

  // 직접 입력한 기록이 고정지출인지: 같은 결제 수단, 고정지출 이름의 낱말이 사용처에 있고, 그 달 아직 맞춘 기록이 없을 때
  function linkFixed(t) {
    const st = API.settings(), U = t.date.slice(0, 7);
    const words = n => String(n || '').replace(/\(.*?\)/g, ' ').split(/[\s·_\-/]+/).map(w => w.replace(/(학원|비|요금|료)$/, '')).filter(w => w.length >= 2);
    const memo = String(t.memo || '').replace(/\s+/g, '');
    return (st.fixed || []).find(f => f.active !== false && f.method === t.method && (!f.from || f.from <= U) && (!f.until || U <= f.until) &&
      !D.tx.some(x => x.id !== t.id && String(x.fixedId) === String(f.id) && x.date.slice(0, 7) === U) &&
      words(f.name).some(w => memo.includes(w)));
  }

  function openTx(id) {
    const t = [...D.tx, ...(D.incomes || [])].find(x => x.id === id);
    if (isOwner()) { openInput({ ...t }); return; }
    const c = cardOf(t.method);
    openSheet(t.memo, `<ul class="rows"><li><span>금액</span><b class="num">${fmt(t.amount)}원</b></li><li><span>날짜</span><b>${t.date}</b></li>
      <li><span>결제</span><b>${c.name}${t.months > 1 ? ` · ${t.months}개월` : ''}</b></li><li><span>분류</span><b>${esc(t.category)}</b></li></ul>`);
  }

  // ---------- 데이터 가져오기 (명세서 8장) ----------
  // 옮기기용 파일(gagyebu-export-v1)은 이 기기 안에서만 읽고, 설정·내역만 시트에 저장한다. 파일 자체는 어디에도 올리지 않는다.
  function openImport() {
    let parsed = null;
    openSheet('데이터 가져오기', `<div class="stack">
      <p style="margin:0;font-size:14.5px;line-height:1.6">지금 쓰는 가계부에서 받은 <b>옮기기용 파일</b>(가계부_데이터_옮기기용_…json)을 골라 주세요.</p>
      <label class="drop" id="drop">${ICON('upload')}<b>파일 고르기</b><small>PC에서는 여기로 끌어다 놓아도 돼요</small>
        <input type="file" id="impFile" accept=".json,application/json" hidden></label>
      <p class="muted" style="margin:0;font-size:12.5px">파일은 이 기기 안에서만 읽어요. 정리된 설정과 내역만 구글 시트에 저장돼요.</p>
      <div id="impPrev"></div></div>`, el => {
      const prev = el.querySelector('#impPrev');
      const read = file => {
        if (!file) return;
        const fr = new FileReader();
        fr.onload = () => {
          try { parsed = JSON.parse(fr.result); } catch (e) { parsed = null; }
          if (!parsed || parsed.format !== 'gagyebu-export-v1' || !parsed.settings || !Array.isArray(parsed.tx)) {
            parsed = null; prev.innerHTML = '<p class="empty" style="margin:0">옮기기용 파일이 아니에요. 파일 이름에 ‘옮기기용’이 들어간 json을 골라 주세요.</p>'; return;
          }
          const s = parsed.settings, tx = parsed.tx.filter(t => t && t.date && t.amount);
          const ds = tx.map(t => t.date).sort();
          const had = API.list('설정').length > 0;
          const again = tx.some(t => D.tx.some(x => x.id === 'imp_' + t.id));
          prev.innerHTML = `<ul class="rows">
              <li><span>카드<small>${(s.cards || []).map(c => esc(c.name)).join(' · ')}</small></span><b>${(s.cards || []).length}개</b></li>
              <li><span>고정지출</span><b>${(s.fixed || []).length}개</b></li>
              <li><span>이번 달 예산</span><b>${(s.plans || []).length}개</b></li>
              <li><span>분류</span><b>${(s.categories || []).length}개</b></li>
              <li><span>내역<small>${ds.length ? `${ds[0]} ~ ${ds[ds.length - 1]}` : ''}</small></span><b>${tx.length}건</b></li></ul>
            ${had ? '<p class="muted" style="margin:10px 0 0;font-size:13px">시트에 이미 있는 설정은 이 파일 내용으로 바뀌어요.</p>' : ''}
            ${again ? '<p class="muted" style="margin:6px 0 0;font-size:13px">전에 가져온 적이 있어요. 다시 가져와도 같은 줄을 고쳐 쓰니 두 번 들어가지 않아요.</p>' : ''}
            <button class="btn primary block" data-act="doImport" style="margin-top:14px;min-height:52px">가져오기</button>`;
        };
        fr.readAsText(file, 'utf-8');
      };
      el.querySelector('#impFile').addEventListener('change', e => read(e.target.files[0]));
      const drop = el.querySelector('#drop');
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); read(e.dataTransfer.files[0]); });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-act="doImport"]'); if (!b || !parsed) return;
        const s = parsed.settings;
        Object.keys(s).forEach(k => { if (s[k] !== undefined) API.write('설정', k, s[k]); });
        const rows = parsed.tx.filter(t => t && t.date && t.amount).map(t => ({
          ...t, id: 'imp_' + (t.id || Math.random().toString(36).slice(2)), amount: +t.amount, months: +t.months || 1,
          unneeded: !!t.unneeded, isFixed: !!t.isFixed, source: 'import', createdAt: t.createdAt || Date.now()
        }));
        S.importing = rows.length;
        API.writeMany('내역', rows);
        parsed = null;
        closeSheet(); S.tab = 'home'; store.set('tab', 'home'); S.month = ymd(new Date()).slice(0, 7);
        D = liveData(); render(); window.scrollTo(0, 0);
        toast('시트에 저장하는 중이에요. 끝나면 알려 드릴게요', 4000);
      });
    });
  }

  // ---------- 명세서 올리기 (명세서 7장) ----------
  // 파일은 이 기기 안에서만 읽는다. 진짜 엑셀(우리·삼성)은 SheetJS로, HTML 표(현대·신한)는 직접 읽는다.
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = () => res(window.XLSX); s.onerror = () => rej(new Error('xlsx'));
      document.head.appendChild(s);
    });
  }
  async function fileRows(file) {
    const buf = new Uint8Array(await file.arrayBuffer());
    const head = new TextDecoder('latin1').decode(buf.slice(0, 200)).trim();
    if (head.startsWith('<')) {
      let s = new TextDecoder('utf-8').decode(buf);
      if ((s.match(/�/g) || []).length > 20) s = new TextDecoder('euc-kr').decode(buf);
      return Statement.htmlRows(s);
    }
    const X = await loadXLSX();
    const wb = X.read(buf, { type: 'array', raw: true });
    const rows = [];
    wb.SheetNames.forEach(sn => { rows.push(...X.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: '' })); rows.push([]); });
    return rows;
  }
  const hashId = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); };

  function openUpload() {
    const U = { files: [], map: {}, cats: {}, skip: {}, add: {}, fixedOk: {}, open: {} };   // map: '회사:라벨' → 카드id
    const st = () => API.settings();
    const cardsOnly = () => D.cards.filter(c => c.id !== 'cash');
    const word = { hyundai: '현대', woori: '우리', samsung: '삼성', shinhan: '신한' };
    const labelKey = (p, label) => `${p.company}:${label}`;
    function guessCard(p, label) {
      const saved = (st().cardNameMap || {})[labelKey(p, label)];
      if (saved && cardsOnly().some(c => c.id === saved)) return saved;
      const cands = cardsOnly().filter(c => c.name.includes(word[p.company] || '@@'));
      if (cands.length === 1) return cands[0].id;
      // 카드 이름 괄호 속 말(하이패스·기아 등)이 명세서 카드 이름에 들어 있으면 그 카드
      const tagged = cands.filter(c => { const m = c.name.match(/\(([^)]+)\)/); return m && label.includes(m[1]); });
      return tagged.length === 1 ? tagged[0].id : '';
    }
    function planAll() {
      let pool = D.tx.slice();
      U.plans = U.files.map(p => {
        const rows = Statement.plan(p, label => U.map[labelKey(p, label)] || '', {
          cards: cardsOnly(), tx: pool, fixed: st().fixed || [], categories: D.categories, rules: st().rules || {}, settings: st(),
          companyCards: [...new Set([...cardsOnly().filter(c => c.name.includes(word[p.company] || '@@')).map(c => c.id),
            ...p.cards.map(l => U.map[labelKey(p, l)]).filter(Boolean)])]
        });
        rows.forEach((r, i) => {
          r.key = p.fileName + '#' + i;
          if (U.cats[r.key]) r.t.category = U.cats[r.key];
          r.on = r.status === 'new' ? !U.skip[r.key] : !!U.add[r.key];
        });
        pool = pool.concat(rows.filter(r => r.on && r.t.method).map(r => r.t));
        return rows;
      });
    }
    const fmtMonth = ym => `${ym.slice(0, 4)}년 ${+ym.slice(5)}월`;
    function draw(el) {
      const box = el.querySelector('#upBody');
      if (!U.files.length) { box.innerHTML = ''; return; }
      // 시트를 다 불러오기 전에 파일을 골랐어도, 비어 있는 카드는 다시 짐작
      U.files.forEach(p => p.cards.forEach(l => { const k = labelKey(p, l); if (!U.map[k]) U.map[k] = guessCard(p, l); }));
      planAll();
      const labels = [];
      U.files.forEach(p => p.cards.forEach(l => { if (!labels.some(x => x.k === labelKey(p, l))) labels.push({ k: labelKey(p, l), p, l }); }));
      const cardSel = (k, v) => `<select class="inp sm" data-k="${esc(k)}" data-up="card"><option value="">카드 고르기</option>${cardsOnly().map(c => `<option value="${c.id}" ${v === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>`;
      const mapHtml = `<section class="up-sec"><h4>명세서 카드 → 가계부 카드</h4><ul class="rows">${labels.map(x =>
        `<li><span>${esc(x.p.companyName)} <b>${esc(x.l || '(이름 없음)')}</b></span>${cardSel(x.k, U.map[x.k])}</li>`).join('')}</ul></section>`;
      let totalAdd = 0;
      const fixedChanges = [];
      const fileHtml = U.files.map((p, fi) => {
        const rows = U.plans[fi];
        const on = rows.filter(r => r.on && r.t.method);
        totalAdd += on.length;
        rows.filter(r => r.on && r.t.fixedChange).forEach(r => fixedChanges.push(r.t.fixedChange));
        const cnt = s => rows.filter(r => r.status === s).length;
        const matched = on.filter(r => r.t.isFixed).length, etc = on.filter(r => r.t.category === '기타').length;
        const chk = p.check.expected == null ? '' : p.check.expected === p.check.got
          ? `<span class="okline">${ICON('check', 'sm')}명세서 합계와 같아요</span>`
          : `<span class="warnline">명세서 합계와 ${fmt(Math.abs(p.check.got - p.check.expected))}원 달라요</span>`;
        const months = []; for (let k = -3; k <= 2; k++) months.push(addMonth(ymd(new Date()).slice(0, 7), k));
        if (!months.includes(p.billMonth)) months.unshift(p.billMonth);
        const list = rows.map(r => {
          const t = r.t;
          return `<tr class="${r.on ? '' : 'off'}"><td><input type="checkbox" data-up="on" data-key="${esc(r.key)}" ${r.on ? 'checked' : ''} ${t.method ? '' : 'disabled'} aria-label="넣기"></td>
            <td class="num">${t.date.slice(5).replace('-', '/')}</td><td>${esc(t.memo)}${t.fixedName ? ` <span class="tag fix">고정 · ${esc(t.fixedName)}</span>` : ''}${r.why ? `<small>${esc(r.why)}</small>` : ''}</td>
            <td class="num r">${fmt(t.amount)}${t.months > 1 ? `<small>${t.months}개월</small>` : ''}</td>
            <td><select class="inp sm" data-up="cat" data-key="${esc(r.key)}">${D.categories.map(c => `<option ${c === t.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></td></tr>`;
        }).join('');
        return `<section class="up-sec"><div class="up-h"><b>${esc(p.companyName)}</b>
            <select class="inp sm" data-up="bill" data-fi="${fi}" aria-label="청구 월">${months.map(m => `<option value="${m}" ${m === p.billMonth ? 'selected' : ''}>${fmtMonth(m)} 청구${p.predicted && m === p.billMonth ? '(예정)' : ''}</option>`).join('')}</select>
            ${p.billFrom === 'guess' ? '<small class="muted">청구 월이 파일에 없어서 짐작했어요. 맞는지 봐 주세요</small>' : ''}</div>
          <p class="up-sum">새로 넣기 <b>${on.length}</b>건 · 이미 있어서 건너뜀 ${cnt('dup')}건${cnt('similar') ? ` · <b class="warnline">비슷해서 확인 필요 ${cnt('similar')}건</b>` : ''}${p.skippedZero ? ` · 0원 ${p.skippedZero}건` : ''}${cnt('nocard') ? ` · <b class="warnline">카드 고르기 필요 ${cnt('nocard')}건</b>` : ''}<br>
            고정지출과 맞춤 ${matched}건 · 분류 ‘기타’ ${etc}건 ${chk}</p>
          <button class="linkrow" data-up="open" data-fi="${fi}" aria-expanded="${!!U.open[fi]}"><span>내역 ${rows.length}줄 보기·고치기</span>${ICON(U.open[fi] ? 'down' : 'right', 'sm')}</button>
          ${U.open[fi] ? `<div class="up-table"><table><thead><tr><th></th><th>날짜</th><th>사용처</th><th class="r">금액</th><th>분류</th></tr></thead><tbody>${list}</tbody></table></div>` : ''}</section>`;
      }).join('');
      const fxHtml = fixedChanges.length ? `<section class="up-sec"><h4>고정지출 금액이 달라요</h4><ul class="rows">${fixedChanges.map(c =>
        `<li><label class="toggle" style="width:100%"><span>${esc(c.name)}<small>${fmt(c.from)}원 → ${fmt(c.to)}원으로 바꿀까요?</small></span><input type="checkbox" class="switch" data-up="fx" data-id="${esc(c.id)}" ${U.fixedOk[c.id] ? 'checked' : ''}></label></li>`).join('')}</ul></section>` : '';
      const need = labels.filter(x => !U.map[x.k]).length;
      box.innerHTML = mapHtml + fileHtml + fxHtml +
        `<button class="btn primary block" data-up="go" style="min-height:52px" ${need || !totalAdd ? 'disabled' : ''}>${need ? '카드를 먼저 골라 주세요' : `${fmt(totalAdd)}건 가져오기`}</button>`;
    }
    openSheet('명세서 올리기', `<div class="stack">
      <p style="margin:0;font-size:14.5px;line-height:1.6">카드사에서 받은 명세서 파일을 골라 주세요. <b>여러 개를 한 번에</b> 골라도 돼요.<br><span class="muted" style="font-size:13px">현대·신한(xls), 우리(xls), 삼성(xlsx)</span></p>
      <label class="drop" id="drop">${ICON('upload')}<b>파일 고르기</b><small>PC에서는 여기로 끌어다 놓아도 돼요</small>
        <input type="file" id="upFile" multiple accept=".xls,.xlsx,.html,.htm" hidden></label>
      <p class="muted" style="margin:0;font-size:12.5px">파일은 이 기기 안에서만 읽어요. 정리된 내역만 구글 시트에 저장돼요.</p>
      <div id="upMsg"></div><div class="stack" id="upBody"></div></div>`, el => {
      const msg = el.querySelector('#upMsg');
      async function take(list) {
        msg.innerHTML = '<p class="muted" style="margin:0">읽는 중…</p>';
        const fails = [];
        for (const f of list) {
          try {
            const p = Statement.parse(await fileRows(f), f.name, ymd(new Date()));
            if (!p.items.length) { fails.push(f.name); continue; }
            U.files = U.files.filter(x => x.fileName !== f.name).concat(p);
            p.cards.forEach(l => { const k = labelKey(p, l); if (!U.map[k]) U.map[k] = guessCard(p, l); });
          } catch (e) { fails.push(f.name); }
        }
        U.files.sort((a, b) => a.billMonth.localeCompare(b.billMonth));
        API.log(`명세서 읽기: 파일 ${list.length}개 중 ${list.length - fails.length}개 읽음`);
        msg.innerHTML = fails.length ? `<p class="warnline" style="margin:0">읽지 못한 파일: ${fails.map(esc).join(', ')}</p>` : '';
        draw(el);
      }
      el.querySelector('#upFile').addEventListener('change', e => take([...e.target.files]));
      const drop = el.querySelector('#drop');
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); take([...e.dataTransfer.files]); });
      el.addEventListener('change', e => {
        const t = e.target, k = t.dataset.up;
        if (k === 'card') U.map[t.dataset.k] = t.value;
        else if (k === 'bill') Statement.setBillMonth(U.files[+t.dataset.fi], t.value);
        else if (k === 'cat') U.cats[t.dataset.key] = t.value;
        else if (k === 'on') { const r = U.plans.flat().find(x => x.key === t.dataset.key); if (r.status === 'new') U.skip[r.key] = !t.checked; else U.add[r.key] = t.checked; }
        else if (k === 'fx') U.fixedOk[t.dataset.id] = t.checked;
        else return;
        draw(el);
      });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-up]'); if (!b) return;
        if (b.dataset.up === 'open') { U.open[b.dataset.fi] = !U.open[b.dataset.fi]; draw(el); }
        if (b.dataset.up !== 'go') return;
        try { goImport(); } catch (err) { API.log('명세서 가져오기 오류: ' + (err && err.message)); toast('가져오기 중 문제가 생겼어요. Claude에게 알려 주세요', 8000); }
      });
      function goImport() {
        const s = st(), rows = [], rules = { ...(s.rules || {}) }, map = { ...(s.cardNameMap || {}) };
        let matched = 0;
        const usedIds = new Set();
        U.files.forEach((p, fi) => {
          const on = U.plans[fi].filter(r => r.on && r.t.method);
          on.forEach(r => {
            const t = { ...r.t }; delete t.fixedChange; delete t.fixedName;
            // 같은 명세서 줄은 늘 같은 id → 다시 올려도 같은 줄을 고쳐 씀. 같은 날 같은 곳 같은 금액이 정말 두 번이면 뒤에 번호
            let id = 's' + hashId(t.importKey), n = 2;
            while (usedIds.has(id)) id = 's' + hashId(t.importKey) + '_' + n++;
            usedIds.add(id); t.id = id; t.createdAt = Date.now();
            if (U.cats[r.key]) rules[Calc.normMerchant(t.memo)] = t.category;
            if (t.isFixed) matched++;
            rows.push(t);
          });
          p.cards.forEach(l => { const k = labelKey(p, l); if (U.map[k]) map[k] = U.map[k]; });
          API.write('업로드기록', 'u' + Date.now().toString(36) + fi, {
            at: Date.now(), source: p.company, fileMonth: p.billMonth, rows: U.plans[fi].length, added: on.length,
            skipped: U.plans[fi].length - on.length, fixedMatched: on.filter(r => r.t.isFixed).length
          });
        });
        // 확정 명세서: 카드별 그 달 청구 합계를 기억 → 그 달 정산은 명세서 금액 그대로
        const conf = JSON.parse(JSON.stringify(s.billConfirmed || {}));
        let confN = 0;
        U.files.forEach(p => {
          const tot = Statement.billTotals(p, label => U.map[labelKey(p, label)] || '',
            [...new Set([...cardsOnly().filter(c => c.name.includes(word[p.company] || '@@')).map(c => c.id), ...p.cards.map(l => U.map[labelKey(p, l)]).filter(Boolean)])]);
          if (!tot) return;
          Object.entries(tot).forEach(([id, v]) => { conf[id] = conf[id] || {}; conf[id][p.billMonth] = Math.round(v); confN++; });
        });
        if (confN) API.write('설정', 'billConfirmed', conf);
        API.write('설정', 'cardNameMap', map);
        if (Object.keys(U.cats).length) API.write('설정', 'rules', rules);
        const ids = Object.keys(U.fixedOk).filter(id => U.fixedOk[id]);
        const changes = U.plans.flat().filter(r => r.on && r.t.fixedChange).map(r => r.t.fixedChange);
        const matchedRows = rows.filter(t => t.isFixed && t.fixedId != null);
        let fixedTouched = false;
        const newFixed = (s.fixed || []).map(f => {
          let g = f;
          const c = changes.find(x => String(x.id) === String(f.id) && ids.includes(String(f.id)));
          if (c) { g = { ...g, amount: c.to }; fixedTouched = true; }
          // '매달 달라요' 항목: 명세서의 실제 금액을 최근 기록에 (같은 달은 새 값으로), 최근 6개만
          const hits = matchedRows.filter(t => String(t.fixedId) === String(f.id));
          if (f.variable && hits.length) {
            const rec = (g.recent || []).filter(x => !hits.some(t => t.date.slice(0, 7) === x.month));
            hits.forEach(t => rec.push({ month: t.date.slice(0, 7), amount: t.amount }));
            rec.sort((a, b) => a.month.localeCompare(b.month));
            g = { ...g, recent: rec.slice(-6) }; fixedTouched = true;
          }
          return g;
        });
        if (fixedTouched) API.write('설정', 'fixed', newFixed);
        S.importing = rows.length;
        API.writeMany('내역', rows);
        closeSheet(); S.tab = 'home'; store.set('tab', 'home'); S.month = ymd(new Date()).slice(0, 7);
        D = liveData(); render(); window.scrollTo(0, 0);
        API.log(`명세서 가져오기: 파일 ${U.files.length}개, 내역 ${rows.length}줄 보냄`);
        toast(`${rows.length}건을 시트에 저장하는 중이에요${matched ? ` (고정지출 ${matched}건 맞춤)` : ''}. 끝나면 알려 드릴게요`, 4000);
      }
    }, 'wide');
  }

  const STEP_TEXT = {
    shop: '장 보면서 물건 값을 누르면 더해지고, 이번 주 장보기 예산과 바로 비교해 보여 드려요.',
    held: '배달·외식을 참았을 때 누른 기록을 모아서, 얼마나 아꼈는지 보여 드려요.',
    goal: '“통신비 요금제 점검” 같은 할 일을 적고, 끝내면 매달 줄인 금액을 홈에 보여 드려요.',
    upload: '카드사에서 받은 명세서 파일을 폰 안에서만 읽어서 내역을 채워요. 파일은 어디에도 올라가지 않아요.',
    set: '카드 결제일, 수입, 고정지출, 예산, 분류를 고치는 곳이에요.',
    import: '지금 쓰는 가계부에서 받은 옮기기용 파일을 골라 한 번에 옮겨요.',
    noti: '퇴근 무렵, 주말 점심·저녁 전, 결제일 3일 전, 일요일 밤에 금액 없이 짧게 알려 드려요.'
  };

  // 설정 화면(js/settings.js)이 쓰는 화면 도구
  const UI_TOOLS = { openSheet, closeSheet, toast, esc, fmt, ICON: window.ICON, refresh: () => { if (LIVE) D = liveData(); render(); } };

  // ---------- 이벤트 ----------
  $app.addEventListener('click', e => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    const a = b.dataset.act;
    if (a === 'tab') { S.tab = b.dataset.tab; store.set('tab', S.tab); render(); window.scrollTo(0, 0); }
    else if (a === 'month') { S.month = addMonth(S.month, Number(b.dataset.k)); render(); }
    else if (a === 'input') openInput(b.dataset.date ? { date: b.dataset.date } : null);
    else if (a === 'fixed') { S.fixedOpen = !S.fixedOpen; render(); }
    else if (a === 'tip') { S.tip++; render(); }
    else if (a === 'held') { if (LIVE && window.OBYE_EXTRAS) OBYE_EXTRAS.held(UI_TOOLS); else toast('참았어요! 잘하셨어요 (예시 화면이라 기록되지 않아요)'); }
    else if (a === 'shop' && LIVE && window.OBYE_EXTRAS) OBYE_EXTRAS.shop(UI_TOOLS);
    else if (a === 'day') openDay(b.dataset.date);
    else if (a === 'tx') openTx(b.dataset.id);
    else if (a === 'hf') { const k = b.dataset.k; S.hist[k] = k === 'bad' ? !S.hist.bad : b.dataset.v; render(); }
    else if (a === 'ana') { S.anaMode = b.dataset.v; render(); }
    else if (a === 'anacat') openAnaCat(b.dataset.cat);
    else if (a === 'loans' || (a === 'menu' && b.dataset.k === 'loans')) openLoans();
    else if (a === 'menu' && b.dataset.k === 'import' && LIVE) openImport();
    else if (a === 'menu' && b.dataset.k === 'upload' && LIVE) openUpload();
    else if (a === 'menu' && LIVE && window.OBYE_EXTRAS && ['shop', 'held', 'goal'].includes(b.dataset.k)) OBYE_EXTRAS[{ shop: 'shop', held: 'heldList', goal: 'goals' }[b.dataset.k]](UI_TOOLS);
    else if (a === 'menu' && b.dataset.k === 'set' && LIVE && window.OBYE_SETTINGS) OBYE_SETTINGS.open(UI_TOOLS);
    else if (a === 'menu' && b.dataset.k === 'noti' && LIVE && window.OBYE_NOTI) OBYE_NOTI.open(UI_TOOLS);
    else if (a === 'menu') { const m = MENU.find(x => x.k === b.dataset.k); openSheet(m.t, `<div class="stack"><p style="margin:0">${STEP_TEXT[m.k]}</p><p class="muted" style="margin:0;font-size:13px">아직 만드는 중이에요. 곧 쓸 수 있어요.</p><button class="btn block" data-act="close">닫기</button></div>`); }
    else if (a === 'switch') { S.role = isOwner() ? 'viewer' : 'owner'; store.set('role', S.role); S.tab = 'home'; render(); toast(isOwner() ? '청지기 화면이에요' : '함께 보기 화면이에요 (입력 버튼이 없어요)'); }
    else if (a === 'logout') {
      S.role = null; S.login = null; store.set('role', null);
      if (LIVE) { API.logout(); D = liveData(); }
      render();
    }
    else if (a === 'retry') { toast('다시 불러오는 중…'); API.sync(); }
    else if (a === 'pick') { S.login = b.dataset.role || null; render(); const p = document.getElementById('pw'); if (p) p.focus(); }
  });
  // 창 안의 버튼 (창은 #app 밖에 붙는다)
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !sheetEl || !sheetEl.contains(b)) return;
    if (b.dataset.act === 'close') closeSheet();
    else if (b.dataset.act === 'tx') openTx(b.dataset.id);
    else if (b.dataset.act === 'input' && b.dataset.date) openInput({ date: b.dataset.date });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  $app.addEventListener('submit', e => {
    if (e.target.id !== 'loginForm') return;
    e.preventDefault();
    const pw = document.getElementById('pw').value;
    if (!pw) { toast('비밀번호를 넣어 주세요'); return; }
    if (!LIVE) { S.role = S.login; S.login = null; S.tab = 'home'; store.set('role', S.role); render(); return; }
    const btn = e.target.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '확인하는 중…';
    API.login(pw).then(r => {
      if (!r.ok) {
        btn.disabled = false; btn.textContent = '들어가기';
        toast({ wrong_password: '비밀번호가 달라요', locked: `여러 번 틀려서 ${r.retryAfterMin || 10}분 동안 잠겼어요`, network: '인터넷 연결을 확인해 주세요' }[r.error] || '잠시 뒤 다시 해 주세요');
        const p = document.getElementById('pw'); if (p) { p.value = ''; p.focus(); }
        return;
      }
      if (r.role !== S.login) toast(r.role === 'owner' ? '청지기 비밀번호라 청지기로 들어왔어요' : '함께 보기 비밀번호라 보기 전용으로 들어왔어요');
      S.role = r.role; S.login = null; S.tab = 'home'; store.set('tab', 'home');
      render(); API.start();
    });
  });

  // 시트에서 새 내용이 오면 다시 그리기 (검색칸에 글자를 넣는 중이면 기다림)
  if (LIVE) {
    API.on((type, info) => {
      if (type === 'logout') { S.role = null; S.login = null; D = liveData(); render(); toast('다시 로그인해 주세요'); return; }
      if (type === 'offline') { S.offline = true; toast('인터넷 연결을 확인해 주세요. 입력은 연결되면 보내요'); }
      if (type === 'online' || (type === 'change' && API.online() && navigator.onLine)) S.offline = false;
      if (type === 'error') { S.importing = 0; toast(`시트에 저장하지 못한 것이 있어요 (${info}). Claude에게 알려 주세요`, 8000); }
      if (type === 'saved') {
        S.savedAt = Date.now();
        setTimeout(() => { if (S.role) render(); }, 5200);       // '저장 완료' 표시 거두기
        if (S.importing) { toast(`가져오기 끝! 구글 시트에 내역 ${fmt(S.importing)}건과 설정을 모두 저장했어요`, 5000); S.importing = 0; }
      }
      D = liveData();
      if (S.role && document.activeElement?.id !== 'hq') render();
    });
    if (S.role) API.start();
    // 폰이 인터넷에서 끊기면 바로 표시 (다시 연결되면 API가 받아 오면서 지움)
    window.addEventListener('offline', () => { if (!S.offline) { S.offline = true; if (S.role) render(); toast('인터넷 연결을 확인해 주세요. 입력은 연결되면 보내요'); } });
  }
  $app.addEventListener('input', e => {
    if (e.target.id === 'hq') {
      S.hist.q = e.target.value.trim();
      const pos = e.target.selectionStart; render();
      const q = document.getElementById('hq'); q.focus(); q.setSelectionRange(pos, pos);
    }
  });

  render();

  // 알림을 눌러서 열었을 때 (명세서 11-2): 홈 / 참았어요 / 다가오는 결제 / 장보기
  function goTo(go) {
    const run = () => {
      closeSheet(); S.tab = 'home'; store.set('tab', 'home'); S.month = ymd(new Date()).slice(0, 7);
      render(); window.scrollTo(0, 0);
      if (go === 'held' && LIVE && isOwner() && window.OBYE_EXTRAS) OBYE_EXTRAS.held(UI_TOOLS);
      else if (go === 'shop' && LIVE && isOwner() && window.OBYE_EXTRAS) OBYE_EXTRAS.shop(UI_TOOLS);
      else if (go === 'pay') { const el = document.getElementById('upcoming'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    };
    if (!LIVE || API.loaded()) { run(); return; }
    const t = setInterval(() => { if (API.loaded()) { clearInterval(t); run(); } }, 300);
    setTimeout(() => clearInterval(t), 20000);
  }
  const goParam = new URLSearchParams(location.search).get('go');
  if (goParam) { history.replaceState(null, '', location.pathname); if (S.role) goTo(goParam); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', e => { if (e.data && e.data.type === 'go' && S.role) goTo(e.data.go); });
  if (LIVE && S.role && window.OBYE_NOTI) setTimeout(OBYE_NOTI.refresh, 5000);     // 이 폰 알림 주소가 바뀌었는지 가끔 확인

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 오프라인 저장만 안 될 뿐 앱은 동작 */ });
  }
})();
