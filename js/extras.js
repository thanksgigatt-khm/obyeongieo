// 7단계: 장보기 모드 · 참았어요 · 줄이기 목표 (명세서 6-3, 6-4, 6-9).
// 장바구니는 저장 전까지 이 기기(localStorage obye.cart)에만 둔다. 참았어요는 시트 '참았어요' 탭, 목표는 설정 goals.
(function () {
  let UI = null;
  const st = () => API.settings();
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = () => ymd(new Date());
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem('obye.' + k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem('obye.' + k); else localStorage.setItem('obye.' + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 동작 */ } }
  };
  const txAll = () => API.list('내역').filter(t => !t.deleted && t.date && t.source !== 'income');
  const isOwner = () => API.role() === 'owner';

  // ---------- 장보기 모드 ----------
  // 이번 주(월~일) 장보기 예산 = 장보기 예산 ÷ 그 달 월요일 수
  function shopBudget() {
    const T = today(), M = T.slice(0, 7);
    const plan = (st().plans || []).find(p => p.active !== false && (p.category === '장보기' || /장보기/.test(p.name)));
    if (!plan) return null;
    const cat = plan.category || '장보기';
    const d = new Date(), mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    const monS = ymd(mon), sunS = ymd(sun);
    const rows = txAll().filter(t => t.category === cat);
    const usedM = rows.filter(t => t.date.startsWith(M)).reduce((s, t) => s + (+t.amount || 0), 0);
    const usedW = rows.filter(t => t.date >= monS && t.date <= sunS).reduce((s, t) => s + (+t.amount || 0), 0);
    const weeks = Calc.mondaysIn(M) || 4;
    const wb = Math.round(+plan.amount / weeks);
    return { cat, month: +plan.amount, monthLeft: +plan.amount - usedM, week: wb, weekLeft: wb - usedW };
  }
  function openShop() {
    const { fmt, esc, ICON } = UI;
    let cart = LS.get('cart') || { items: [], method: null };
    const cards = [...(st().cards || []), { id: 'cash', name: '현금' }];
    if (!cart.method) cart.method = cards[0] ? cards[0].id : 'cash';
    const keep = () => LS.set('cart', cart.items.length ? cart : null);
    const draw = el => {
      const B = shopBudget(), total = cart.items.reduce((s, i) => s + i.price, 0);
      const left = B ? B.weekLeft - total : null;
      const state = !B ? '' : left < 0 ? 'over' : total >= B.weekLeft * 0.8 ? 'warn' : 'good';
      el.querySelector('#shop').innerHTML = `
        ${B ? `<div class="shop-top"><div><small>이번 주 장보기 남은 돈</small><b class="num ${B.weekLeft < 0 ? 'neg' : ''}">${fmt(B.weekLeft)}원</b></div>
          <div><small>이번 달 남은 돈</small><b class="num">${fmt(B.monthLeft)}원</b></div></div>`
          : `<p class="muted" style="margin:0;font-size:13px">설정 → 이번 달 예산에 ‘장보기’ 예산을 넣으면 남은 돈과 비교해 드려요.</p>`}
        <div class="shop-total ${state}"><span>장바구니</span><b class="num">${fmt(total)}원</b></div>
        ${B && total ? `<p class="shop-msg ${state}">${left < 0 ? `이번 주 예산을 <b>${fmt(-left)}원</b> 넘어요` : `담고 나면 이번 주 <b>${fmt(left)}원</b> 남아요`}</p>` : ''}
        <ul class="cart">${cart.items.map((it, i) => `<li><span>${esc(it.name || '물건 ' + (i + 1))}</span><b class="num">${fmt(it.price)}</b><button class="iconbtn" data-s="rm" data-i="${i}" aria-label="빼기">${ICON('x', 'sm')}</button></li>`).reverse().join('')}</ul>`;
      el.querySelector('#shopSave').disabled = !total;
    };
    UI.openSheet('장보기 모드', `<div class="stack">
      <div class="stack" id="shop"></div>
      <form class="cart-add" id="cartAdd">
        <input class="inp" id="cName" autocomplete="off" placeholder="물건 (안 써도 돼요)" aria-label="물건 이름">
        <input class="inp" id="cPrice" inputmode="numeric" autocomplete="off" placeholder="가격" aria-label="가격">
        <button class="btn primary" type="submit">${ICON('plus', 'sm')}담기</button></form>
      <div class="field"><span>결제</span><div class="chips wrap-chips" id="cMethod">${cards.map(c => `<button class="chip" type="button" data-s="m" data-v="${c.id}" aria-pressed="${cart.method === c.id}">${esc(c.name)}</button>`).join('')}</div></div>
      <button class="btn primary block" id="shopSave" data-s="save" style="min-height:52px">계산 끝 → 지출로 저장</button>
      <button class="btn block" data-s="clear">장바구니 비우기</button>
      <p class="muted" style="margin:0;font-size:12.5px">장바구니는 저장하기 전까지 이 폰에만 남아요. 앱을 닫아도 그대로예요.</p></div>`, el => {
      draw(el);
      const price = el.querySelector('#cPrice');
      price.addEventListener('input', () => { const n = Number(price.value.replace(/[^\d]/g, '')); price.value = n ? fmt(n) : ''; });
      el.querySelector('#cartAdd').addEventListener('submit', e => {
        e.preventDefault();
        const n = Number(price.value.replace(/[^\d]/g, ''));
        if (!n) { UI.toast('가격을 넣어 주세요'); price.focus(); return; }
        cart.items.push({ name: el.querySelector('#cName').value.trim(), price: n });
        keep(); price.value = ''; el.querySelector('#cName').value = ''; draw(el); price.focus();
      });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        if (b.dataset.s === 'rm') { cart.items.splice(+b.dataset.i, 1); keep(); draw(el); }
        if (b.dataset.s === 'm') { cart.method = b.dataset.v; keep(); el.querySelectorAll('#cMethod .chip').forEach(c => c.setAttribute('aria-pressed', c.dataset.v === cart.method)); }
        if (b.dataset.s === 'clear') {
          if (!cart.items.length) return;
          if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = '한 번 더 누르면 비워져요'; return; }
          cart.items = []; keep(); b.classList.remove('armed'); b.textContent = '장바구니 비우기'; draw(el);
        }
        if (b.dataset.s === 'save') {
          const total = cart.items.reduce((s, i) => s + i.price, 0); if (!total) return;
          const names = cart.items.map(i => i.name).filter(Boolean);
          const now = Date.now();
          const row = { id: 't' + now.toString(36) + Math.random().toString(36).slice(2, 6), date: today(), amount: total, method: cart.method,
            category: (shopBudget() || {}).cat || '장보기', memo: '장보기' + (names.length ? ': ' + names.slice(0, 3).join(', ') + (names.length > 3 ? ` 외 ${names.length - 3}` : '') : ''),
            months: 1, unneeded: false, isFixed: false, source: 'manual', createdAt: now };
          API.write('내역', row.id, row);
          cart = { items: [], method: cart.method }; LS.set('cart', null);
          UI.refresh(); UI.closeSheet(); UI.toast(`장보기 ${fmt(total)}원을 저장했어요`);
        }
      });
    });
  }

  // ---------- 참았어요 ----------
  const HELD_KINDS = [['배달', ['배달']], ['외식', ['외식']], ['카페·간식', ['카페·간식']], ['쇼핑', ['온라인쇼핑', '쇼핑·의류']], ['기타', []]];
  // 최근 3달 그 분류 한 번 평균 (천 원 단위), 없으면 기본값
  function guessAmount(kind) {
    const cats = (HELD_KINDS.find(k => k[0] === kind) || [0, []])[1];
    const from = ymd(new Date(Date.now() - 90 * 864e5));
    const rows = txAll().filter(t => cats.includes(t.category) && t.date >= from && +t.amount > 0 && +t.amount < 200000);
    if (!rows.length) return { 배달: 25000, 외식: 40000, '카페·간식': 8000, 쇼핑: 30000 }[kind] || 10000;
    return Math.round(rows.reduce((s, t) => s + +t.amount, 0) / rows.length / 1000) * 1000;
  }
  function openHeld() {
    const { fmt, esc, ICON } = UI;
    const v = { kind: '배달', amount: guessAmount('배달'), memo: '' };
    const draw = el => {
      el.querySelector('#hk').innerHTML = HELD_KINDS.map(([k]) => `<button class="chip" type="button" data-s="k" data-v="${k}" aria-pressed="${v.kind === k}">${k}</button>`).join('');
      el.querySelector('#ha').value = v.amount ? fmt(v.amount) : '';
    };
    UI.openSheet('참았어요', `<div class="stack">
      <p style="margin:0;font-size:15px;line-height:1.6">잘하셨어요! 무엇을 참았나요?</p>
      <div class="chips wrap-chips" id="hk"></div>
      <label class="field"><span>대략 얼마 아꼈나요 <small class="muted">(최근 평균으로 미리 넣었어요)</small></span>
        <div class="amount-in plus"><input id="ha" inputmode="numeric" autocomplete="off" aria-label="아낀 금액"><span>원</span></div></label>
      <label class="field"><span>메모 (안 써도 돼요)</span><input class="inp" id="hm" autocomplete="off" placeholder="예: 치킨 대신 집밥"></label>
      <button class="btn primary block" data-s="save" style="min-height:52px">${ICON('hand', 'sm')}기록하기</button>
      <p class="muted" style="margin:0;font-size:12.5px">기록용 격려예요. 정산 숫자에는 들어가지 않아요.</p></div>`, el => {
      draw(el);
      const a = el.querySelector('#ha');
      a.addEventListener('input', () => { const n = Number(a.value.replace(/[^\d]/g, '')); v.amount = n; a.value = n ? fmt(n) : ''; });
      el.querySelector('#hm').addEventListener('input', e => { v.memo = e.target.value; });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        if (b.dataset.s === 'k') { v.kind = b.dataset.v; v.amount = guessAmount(v.kind); draw(el); }
        if (b.dataset.s === 'save') {
          const id = newId('h');
          API.write('참았어요', id, { id, date: today(), kind: v.kind, amount: v.amount || 0, memo: v.memo.trim() });
          const n = API.list('참았어요').filter(h => !h.deleted && (h.date || '').startsWith(today().slice(0, 7))).length;
          UI.refresh(); UI.closeSheet(); UI.toast(`이번 달 ${n}번째 참았어요! 약 ${fmt(v.amount || 0)}원 아꼈어요`, 3000);
        }
      });
      setTimeout(() => a.focus(), 50);
    });
  }
  function heldList() {
    const { fmt, esc, ICON } = UI;
    const all = API.list('참았어요').filter(h => !h.deleted && h.date).sort((a, b) => (a.date < b.date ? 1 : -1));
    const M = today().slice(0, 7), Y = M.slice(0, 4);
    const sum = l => l.reduce((s, h) => s + (+h.amount || 0), 0);
    const mo = all.filter(h => h.date.startsWith(M)), yr = all.filter(h => h.date.startsWith(Y));
    const byKind = {}; yr.forEach(h => { (byKind[h.kind] ??= { n: 0, s: 0 }); byKind[h.kind].n++; byKind[h.kind].s += +h.amount || 0; });
    const groups = {}; all.slice(0, 60).forEach(h => { (groups[h.date.slice(0, 7)] ??= []).push(h); });
    UI.openSheet('참았어요 기록', `<div class="stack">
      <div class="shop-top"><div><small>이번 달</small><b class="num">${mo.length}번 · ${fmt(sum(mo))}원</b></div><div><small>올해</small><b class="num pos">${yr.length}번 · ${fmt(sum(yr))}원</b></div></div>
      ${Object.keys(byKind).length ? `<div class="chips wrap-chips">${Object.entries(byKind).sort((a, b) => b[1].n - a[1].n).map(([k, x]) => `<span class="chip" style="cursor:default">${esc(k)} ${x.n}번</span>`).join('')}</div>` : ''}
      ${isOwner() ? `<button class="btn primary block" data-s="new">${ICON('hand', 'sm')}참았어요</button>` : ''}
      ${all.length ? Object.entries(groups).map(([m, l]) => `<div><h4 class="set-h">${m.slice(0, 4)}년 ${+m.slice(5)}월</h4><ul class="set-list">${l.map(h => `
        <li><div class="held-row"><span class="tt"><b>${esc(h.kind)}${h.memo ? ` · ${esc(h.memo)}` : ''}</b><small>${+h.date.slice(5, 7)}월 ${+h.date.slice(8)}일</small></span>
        <span class="num r">${fmt(+h.amount || 0)}</span>${isOwner() ? `<button class="iconbtn" data-s="del" data-id="${esc(h.id)}" aria-label="지우기">${ICON('x', 'sm')}</button>` : ''}</div></li>`).join('')}</ul></div>`).join('')
        : '<p class="empty" style="margin:0">아직 기록이 없어요. 배달·외식을 참았을 때 홈의 [참았어요]를 눌러 주세요.</p>'}</div>`, el => {
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        if (b.dataset.s === 'new') openHeld();
        if (b.dataset.s === 'del') {
          if (!b.classList.contains('armed')) { b.classList.add('armed'); UI.toast('한 번 더 누르면 지워져요'); return; }
          API.remove('참았어요', b.dataset.id); UI.refresh(); heldList(); UI.toast('지웠어요');
        }
      });
    }, 'wide');
  }

  // ---------- 줄이기 목표 ----------
  const STATUS = [['todo', '할 일'], ['doing', '하는 중'], ['done', '끝']];
  function goalList() {
    const { fmt, esc, ICON } = UI;
    const goals = st().goals || [];
    const saved = goals.filter(g => g.status === 'done').reduce((s, g) => s + (+g.monthly || 0), 0);
    const ideas = ['통신비 요금제 점검', '안 쓰는 구독 해지', '보험 보장 겹치는지 확인', '배달 주 1회로 줄이기'].filter(t => !goals.some(g => g.title === t));
    UI.openSheet('줄이기 목표', `<div class="stack">
      <div class="shop-top"><div><small>끝낸 목표로 줄인 돈</small><b class="num pos">매달 ${fmt(saved)}원</b></div><div><small>목표</small><b class="num">${goals.filter(g => g.status === 'done').length} / ${goals.length}개 끝</b></div></div>
      ${goals.length ? `<ul class="set-list">${goals.map(g => `<li><div class="goal-row ${g.status === 'done' ? 'done' : ''}">
        <span class="tt"><b>${esc(g.title)}</b><small>줄이면 매달 약 ${fmt(+g.monthly || 0)}원</small></span>
        ${isOwner() ? `<div class="seg3">${STATUS.map(([k, t]) => `<button data-s="st" data-id="${esc(g.id)}" data-v="${k}" aria-pressed="${(g.status || 'todo') === k}">${t}</button>`).join('')}</div>
          <button class="iconbtn" data-s="del" data-id="${esc(g.id)}" aria-label="지우기">${ICON('x', 'sm')}</button>` : `<span class="pill">${(STATUS.find(s => s[0] === (g.status || 'todo')) || [])[1]}</span>`}</div></li>`).join('')}</ul>`
        : '<p class="muted" style="margin:0;font-size:14px">줄여 볼 일을 적어 두고, 끝내면 ‘끝’을 눌러 주세요. 줄인 돈이 홈 맨 아래에 보여요.</p>'}
      ${isOwner() ? `<form class="stack" id="gAdd" style="gap:10px">
        <div class="row2"><input class="inp" id="gT" placeholder="예: 통신비 요금제 점검" autocomplete="off" aria-label="목표"><input class="inp" id="gM" inputmode="numeric" placeholder="매달 줄일 돈" autocomplete="off" aria-label="매달 줄일 돈"></div>
        ${ideas.length ? `<div class="chips wrap-chips">${ideas.map(t => `<button class="chip" type="button" data-s="idea" data-v="${esc(t)}">${esc(t)}</button>`).join('')}</div>` : ''}
        <button class="btn primary block" type="submit">${ICON('plus', 'sm')}목표 추가</button></form>
        <p class="muted" style="margin:0;font-size:12.5px">실제로 요금이 바뀌면 설정 → 고정지출에서 금액도 고쳐 주세요. 그래야 정산 숫자가 맞아요.</p>` : ''}</div>`, el => {
      const gm = el.querySelector('#gM');
      if (gm) gm.addEventListener('input', () => { const n = Number(gm.value.replace(/[^\d]/g, '')); gm.value = n ? fmt(n) : ''; });
      const f = el.querySelector('#gAdd');
      if (f) f.addEventListener('submit', e => {
        e.preventDefault();
        const title = el.querySelector('#gT').value.trim(), monthly = Number(gm.value.replace(/[^\d]/g, ''));
        if (!title) { UI.toast('목표를 적어 주세요'); return; }
        const list = [...goals, { id: newId('g'), title, monthly, status: 'todo', createdAt: today() }];
        API.write('설정', 'goals', list); UI.refresh(); goalList(); UI.toast('목표를 넣었어요');
      });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        if (b.dataset.s === 'idea') { el.querySelector('#gT').value = b.dataset.v; gm.focus(); }
        if (b.dataset.s === 'st') {
          const list = goals.map(g => g.id === b.dataset.id ? { ...g, status: b.dataset.v, doneAt: b.dataset.v === 'done' ? today() : undefined } : g);
          API.write('설정', 'goals', JSON.parse(JSON.stringify(list))); UI.refresh(); goalList();
          if (b.dataset.v === 'done') UI.toast('목표를 끝냈어요! 잘하셨어요');
        }
        if (b.dataset.s === 'del') {
          if (!b.classList.contains('armed')) { b.classList.add('armed'); UI.toast('한 번 더 누르면 지워져요'); return; }
          API.write('설정', 'goals', goals.filter(g => g.id !== b.dataset.id)); UI.refresh(); goalList();
        }
      });
    }, 'wide');
  }

  window.OBYE_EXTRAS = {
    shop: ui => { UI = ui; openShop(); },
    held: ui => { UI = ui; openHeld(); },
    heldList: ui => { UI = ui; heldList(); },
    goals: ui => { UI = ui; goalList(); },
    shopBudget: () => shopBudget()
  };
})();
