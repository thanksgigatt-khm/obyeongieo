// 설정 화면 (명세서 5단계): 고정지출 · 수입 · 카드 · 예산 · 분류(기타 정리) · 대출 · 모으는 통장.
// 고친 내용은 구글 시트 '설정' 탭에 바로 저장한다. 화면 도구(창 열기·알림)는 app.js가 OBYE_UI로 넘겨준다.
(function () {
  let UI = null;
  const st = () => API.settings();
  const copy = v => JSON.parse(JSON.stringify(v == null ? null : v));
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const thisMonth = () => today().slice(0, 7);
  const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  const PALETTE = ['#3f74c9', '#4f9a5a', '#c9708a', '#8a6fc0', '#4fa3cf', '#c98a3f', '#6b7f99'];

  function save(key, value, msg) {
    API.write('설정', key, value);
    UI.refresh();
    if (msg) UI.toast(msg);
  }
  const cards = () => (st().cards || []);
  const methodName = id => id === 'cash' ? '현금·이체' : (cards().find(c => c.id === id) || { name: id }).name;
  const catNames = () => (st().categories || Calc.DEFAULT_CATS).map(c => typeof c === 'string' ? c : c.name);

  // ---------- 공통: 목록 창과 입력 창 ----------
  // rows: [{ id, title, sub, right, muted }]
  function listSheet(title, rows, opt) {
    const { esc, ICON } = UI;
    const body = `<div class="stack">
      <button class="back-link" data-s="home">${ICON('left', 'sm')}설정</button>
      ${opt.intro ? `<p class="muted" style="margin:0;font-size:13px;line-height:1.6">${opt.intro}</p>` : ''}
      ${opt.groups.map(g => g.rows.length ? `<div><h4 class="set-h">${esc(g.title)}</h4><ul class="set-list">${g.rows.map(r => `
        <li><button data-s="edit" data-id="${esc(r.id)}" class="${r.muted ? 'off' : ''}"><span class="tt"><b>${esc(r.title)}</b>${r.sub ? `<small>${r.sub}</small>` : ''}</span>
        ${r.right != null ? `<span class="num r">${r.right}</span>` : ''}${ICON('right', 'sm')}</button></li>`).join('')}</ul></div>` : '').join('')}
      ${opt.add ? `<button class="btn primary block" data-s="add">${ICON('plus', 'sm')}${esc(opt.add)}</button>` : ''}
      ${opt.foot || ''}</div>`;
    UI.openSheet(title, body, el => {
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        if (b.dataset.s === 'home') open();
        if (b.dataset.s === 'edit') opt.onEdit(b.dataset.id);
        if (b.dataset.s === 'add') opt.onEdit(null);
      });
      if (opt.mount) opt.mount(el);
    }, 'wide');
  }

  // fields: [{ k, label, type: text|money|number|day|month|select|toggle|note, options:[[v,label]], hint, show(v) }]
  function formSheet(title, fields, value, opt) {
    const { esc, fmt, ICON } = UI;
    const v = copy(value);
    const draw = el => {
      el.querySelector('#sf').innerHTML = fields.filter(f => !f.show || f.show(v)).map(f => {
        const val = v[f.k];
        const hint = f.hint ? `<small class="muted" style="font-size:12px">${f.hint}</small>` : '';
        if (f.type === 'note') return `<p class="muted" style="margin:0;font-size:13px;line-height:1.6">${f.label}</p>`;
        if (f.type === 'toggle') return `<label class="toggle"><span>${f.label}${hint ? '<br>' + hint : ''}</span><input class="switch" type="checkbox" data-k="${f.k}" ${val ? 'checked' : ''}></label>`;
        if (f.type === 'select') return `<div class="field"><span>${f.label}</span><div class="chips wrap-chips">${f.options().map(([ov, ol]) =>
          `<button class="chip" type="button" data-k="${f.k}" data-v="${esc(ov)}" aria-pressed="${String(val) === String(ov)}">${esc(ol)}</button>`).join('')}</div>${hint}</div>`;
        const shown = val == null || val === '' ? '' : f.type === 'money' ? fmt(val) : val;
        const attrs = f.type === 'month' ? 'type="month"' : f.type === 'text' ? 'type="text" autocomplete="off"' : 'inputmode="numeric" autocomplete="off"';
        return `<label class="field"><span>${f.label}</span><input class="inp" ${attrs} data-k="${f.k}" data-t="${f.type}" value="${esc(shown)}" placeholder="${esc(f.ph || '')}">${hint}</label>`;
      }).join('');
    };
    UI.openSheet(title, `<div class="stack">
      <button class="back-link" data-s="back">${ICON('left', 'sm')}${esc(opt.backLabel || '뒤로')}</button>
      <div class="stack" id="sf"></div>
      <button class="btn primary block" data-s="save" style="min-height:52px">저장</button>
      ${opt.onDelete ? `<button class="btn danger block" data-s="del">${esc(opt.delLabel || '지우기')}</button>` : ''}</div>`, el => {
      draw(el);
      el.addEventListener('input', e => {
        const k = e.target.dataset.k; if (!k || e.target.type === 'checkbox') return;
        const t = e.target.dataset.t;
        if (t === 'money' || t === 'number' || t === 'day') {
          const raw = e.target.value.replace(t === 'number' ? /[^\d.]/g : /[^\d]/g, '');
          v[k] = raw === '' ? '' : (t === 'number' ? raw : Number(raw));
          if (t === 'money') e.target.value = raw === '' ? '' : fmt(+raw);
        } else v[k] = e.target.value;
      });
      el.addEventListener('change', e => {
        const k = e.target.dataset.k;
        if (k && e.target.type === 'checkbox') { v[k] = e.target.checked; draw(el); }
      });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-k][data-v], [data-s]'); if (!b) return;
        if (b.dataset.v != null && b.dataset.k) { v[b.dataset.k] = b.dataset.v; draw(el); return; }
        if (b.dataset.s === 'back') opt.back();
        if (b.dataset.s === 'save') { const err = opt.onSave(v); if (err) UI.toast(err); }
        if (b.dataset.s === 'del') {
          if (!b.classList.contains('armed')) { b.classList.add('armed'); b.textContent = '한 번 더 누르면 지워져요'; return; }
          opt.onDelete(v);
        }
      });
    }, 'wide');
  }
  const num = x => x === '' || x == null ? null : +x;
  const clean = o => { Object.keys(o).forEach(k => { if (o[k] === '' || o[k] == null) delete o[k]; }); return o; };

  // ---------- 처음 화면 ----------
  function open() {
    const s = st(), { ICON, esc } = UI;
    const etc = API.list('내역').filter(t => !t.deleted && t.source !== 'income' && (t.category || '기타') === '기타').length;
    const items = [
      ['fixed', 'repeat', '고정지출', `${(s.fixed || []).filter(f => f.active !== false).length}개 · 추가·금액·결제일·그만 내기`],
      ['income', 'wallet', '수입', '월급 · 받는 날'],
      ['cards', 'card', '카드', '결제일 · 이용 기간'],
      ['plans', 'target', '이번 달 예산', '주유 · 장보기 같은 한 달 예산'],
      ['cats', 'tag', '분류 정리', etc ? `‘기타’로 들어간 기록 ${etc}건 정리하기` : '분류 추가 · 필수/선택'],
      ['loans', 'bank', '대출', '새 대출 · 남은 원금 · 이자'],
      ['savings', 'piggy', '모으는 통장', '주택청약 같은 적금']
    ];
    UI.openSheet('설정', `<div class="stack"><ul class="menu set-menu">${items.map(([k, i, t, sub]) =>
      `<li><button data-s="${k}"><span class="mi">${ICON(i)}</span><span class="tt"><b>${t}</b><small>${esc(sub)}</small></span>${ICON('right', 'sm')}</button></li>`).join('')}</ul>
      <p class="muted" style="margin:0;font-size:12.5px">고친 내용은 구글 시트에 바로 저장되고, 함께 보기 화면에도 반영돼요.</p></div>`, el => {
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        ({ fixed: fixedList, income: incomeForm, cards: cardList, plans: planList, cats: catHome, loans: loanList, savings: savingsList })[b.dataset.s]();
      });
    });
  }

  // ---------- 고정지출 ----------
  function fixedList() {
    const s = st(), M = thisMonth(), C = Calc.create({ settings: s, tx: API.list('내역') }), { fmt } = UI;
    const all = s.fixed || [];
    const sub = f => {
      const bits = [methodName(f.method), `${f.day || 1}일`];
      if (f.variable) bits.push('매달 달라요');
      if (f.pct) bits.push(`급여의 ${f.pct}%`);
      if (f.perWeek) bits.push(`한 주 ${fmt(f.perWeek)}원`);
      if (f.until) bits.push(`${f.until.replace('-', '.')}까지`);
      if (f.from && f.from > M) bits.push(`${f.from.replace('-', '.')}부터`);
      return bits.join(' · ');
    };
    const on = all.filter(f => f.active !== false && (!f.until || f.until >= M));
    const off = all.filter(f => !on.includes(f));
    const groups = {};
    on.forEach(f => { (groups[f.method] ??= []).push(f); });
    const order = [...cards().map(c => c.id), 'cash'];
    const total = on.filter(f => C.fixedOn(f, M)).reduce((a, f) => a + C.fixedAmt(f, M), 0);
    listSheet('고정지출', [], {
      intro: `이번 달 고정지출 합계 <b>${fmt(total)}원</b> · 눌러서 고치거나 그만 낼 수 있어요.`,
      groups: [...Object.keys(groups).sort((a, b) => order.indexOf(a) - order.indexOf(b)).map(m => ({
        title: methodName(m),
        rows: groups[m].sort((a, b) => (+a.day || 1) - (+b.day || 1)).map(f => ({ id: f.id, title: f.name, sub: sub(f), right: fmt(C.fixedOn(f, M) ? C.fixedAmt(f, M) : +f.amount || 0) }))
      })), { title: '쉬는 중 · 끝난 것', rows: off.map(f => ({ id: f.id, title: f.name, sub: sub(f), right: fmt(+f.amount || 0), muted: true })) }],
      add: '고정지출 추가',
      onEdit: id => fixedForm(id)
    });
  }
  function fixedForm(id) {
    const s = st(), list = copy(s.fixed || []);
    const cur = id ? list.find(f => f.id === id) : { name: '', amount: '', day: new Date().getDate(), method: cards()[0] ? cards()[0].id : 'cash', category: '', from: thisMonth(), active: true };
    const loanLinked = id && (s.loans || []).some(L => L.fixedId === id);
    const v = { ...cur, stop: cur.active === false, debt: !!cur.debtTotal };
    formSheet(id ? '고정지출 고치기' : '고정지출 추가', [
      { k: 'name', label: '이름', type: 'text', ph: '예: 수학학원' },
      { k: 'pct', label: '내 급여의 몇 %', type: 'number', show: x => !!cur.pct, hint: '수입 설정의 ‘십일조 기준 급여’로 계산해요' },
      { k: 'perWeek', label: '한 주 금액', type: 'money', show: x => !!cur.perWeek, hint: '그 달 월요일 수만큼 곱해요' },
      { k: 'amount', label: '금액', type: 'money', show: x => !cur.pct && !cur.perWeek, hint: '매달 다르면 대략의 금액. 실제 금액이 쌓이면 최근 3번 평균으로 바뀌어요' },
      { k: 'variable', label: '매달 금액이 달라요', type: 'toggle', show: x => !cur.pct && !cur.perWeek },
      { k: 'method', label: '결제', type: 'select', options: () => [...cards().map(c => [c.id, c.name]), ['cash', '현금·이체']] },
      { k: 'day', label: '매달 며칠에 나가나요', type: 'day', ph: '1~31' },
      { k: 'category', label: '분류', type: 'select', options: () => catNames().map(c => [c, c]) },
      { k: 'from', label: '시작 달', type: 'month' },
      { k: 'until', label: '끝 달 (계속 내면 비워 두세요)', type: 'month' },
      { k: 'debt', label: '빚을 나눠 갚는 중이에요', type: 'toggle', hint: '켜면 홈 ‘갚아가는 중’에 막대로 보여요' },
      { k: 'debtTotal', label: '갚을 돈 전체', type: 'money', show: x => x.debt },
      { k: 'debtStart', label: '이 앱에서 세기 시작한 달', type: 'month', show: x => x.debt },
      { k: 'debtPaid', label: '그 달 전에 이미 갚은 돈', type: 'money', show: x => x.debt },
      { k: 'stop', label: '이제 안 내요 (쉬는 중)', type: 'toggle', show: () => !!id, hint: '기록은 남기고 계산에서만 빠져요' },
      { k: 'note', label: '메모', type: 'text' },
      { k: 'linked', label: '대출과 연결된 항목이라 여기서는 지울 수 없어요. 다 갚으면 설정 → 대출에서 ‘다 갚았어요’를 눌러 주세요.', type: 'note', show: () => !!loanLinked }
    ], v, {
      backLabel: '고정지출', back: fixedList,
      onSave: x => {
        if (!String(x.name || '').trim()) return '이름을 넣어 주세요';
        if (!cur.pct && !cur.perWeek && !(+x.amount > 0)) return '금액을 넣어 주세요';
        const d = +x.day; if (!(d >= 1 && d <= 31)) return '날짜는 1~31 사이로 넣어 주세요';
        if (x.from && x.until && x.until < x.from) return '끝 달이 시작 달보다 빨라요';
        if (x.debt && !(+x.debtTotal > 0)) return '갚을 돈 전체를 넣어 주세요';
        const out = { ...cur, name: x.name.trim(), day: d, method: x.method, category: x.category || cur.category, from: x.from, until: x.until, note: x.note, variable: !!x.variable, active: !x.stop };
        if (cur.pct) out.pct = +x.pct; else if (cur.perWeek) out.perWeek = +x.perWeek; else out.amount = +x.amount;
        if (x.debt) Object.assign(out, { debtTotal: +x.debtTotal, debtStart: x.debtStart || x.from || thisMonth(), debtPaid: +x.debtPaid || 0 });
        else { delete out.debtTotal; delete out.debtStart; delete out.debtPaid; }
        if (!out.variable) delete out.variable;
        clean(out);
        if (id) list[list.findIndex(f => f.id === id)] = out;
        else { out.id = newId('f'); list.push(out); }
        save('fixed', list, id ? '고쳤어요' : `‘${out.name}’을 고정지출에 넣었어요`);
        fixedList();
      },
      delLabel: '목록에서 지우기',
      onDelete: id && !loanLinked ? () => {
        save('fixed', list.filter(f => f.id !== id), '지웠어요');
        fixedList();
      } : null
    });
  }

  // ---------- 수입 ----------
  function incomeForm() {
    const s = st(), { fmt, esc, ICON } = UI;
    const parts = copy(s.incomeParts && s.incomeParts.length ? s.incomeParts : [{ name: '월급', amount: +s.income || 0, day: +s.payday || 25 }]);
    let salary = +s.salary || (parts[0] ? +parts[0].amount : 0);
    const draw = el => {
      el.querySelector('#inc').innerHTML = parts.map((p, i) => `<div class="set-box">
        <div class="row2"><label class="field"><span>이름</span><input class="inp" data-i="${i}" data-k="name" value="${esc(p.name || '')}"></label>
        <label class="field"><span>받는 날</span><input class="inp" inputmode="numeric" data-i="${i}" data-k="day" value="${p.day || ''}"></label></div>
        <label class="field"><span>금액</span><input class="inp" inputmode="numeric" data-i="${i}" data-k="amount" value="${p.amount ? fmt(p.amount) : ''}"></label>
        ${parts.length > 1 ? `<button class="link-btn" data-s="rm" data-i="${i}">이 수입 빼기</button>` : ''}</div>`).join('') +
        `<div class="set-sum">한 달 수입 합계 <b class="num">${fmt(parts.reduce((a, p) => a + (+p.amount || 0), 0))}원</b></div>`;
    };
    UI.openSheet('수입', `<div class="stack">
      <button class="back-link" data-s="home">${ICON('left', 'sm')}설정</button>
      <div class="stack" id="inc"></div>
      <button class="btn block" data-s="add">${ICON('plus', 'sm')}수입 추가</button>
      <label class="field"><span>십일조 기준 급여</span><input class="inp" inputmode="numeric" id="sal" value="${salary ? fmt(salary) : ''}"><small class="muted" style="font-size:12px">고정지출 중 ‘급여의 %’ 항목을 이 금액으로 계산해요</small></label>
      <p class="muted" style="margin:0;font-size:12.5px">그때그때 들어오는 돈은 입력 → 들어온 돈으로 넣어 주세요.</p>
      <button class="btn primary block" data-s="save" style="min-height:52px">저장</button></div>`, el => {
      draw(el);
      el.addEventListener('input', e => {
        if (e.target.id === 'sal') { salary = Number(e.target.value.replace(/[^\d]/g, '')) || 0; e.target.value = salary ? fmt(salary) : ''; return; }
        const i = e.target.dataset.i, k = e.target.dataset.k; if (i == null) return;
        if (k === 'name') parts[i].name = e.target.value;
        else { const n = Number(e.target.value.replace(/[^\d]/g, '')) || 0; parts[i][k] = n; if (k === 'amount') e.target.value = n ? fmt(n) : ''; }
        const sum = el.querySelector('.set-sum b'); if (sum) sum.textContent = fmt(parts.reduce((a, p) => a + (+p.amount || 0), 0)) + '원';
      });
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        if (b.dataset.s === 'home') open();
        if (b.dataset.s === 'add') { parts.push({ name: '', amount: 0, day: 1 }); draw(el); }
        if (b.dataset.s === 'rm') { parts.splice(+b.dataset.i, 1); draw(el); }
        if (b.dataset.s === 'save') {
          const bad = parts.find(p => !String(p.name || '').trim() || !(+p.amount > 0) || !(+p.day >= 1 && +p.day <= 31));
          if (bad) { UI.toast('이름·금액·받는 날(1~31)을 모두 넣어 주세요'); return; }
          const clean2 = parts.map(p => ({ name: p.name.trim(), amount: +p.amount, day: +p.day }));
          const total = clean2.reduce((a, p) => a + p.amount, 0);
          API.write('설정', 'incomeParts', clean2);
          API.write('설정', 'income', total);
          API.write('설정', 'payday', clean2[0].day);
          API.write('설정', 'incomeNote', clean2.map(p => `${p.name} ${fmt(p.amount)}`).join(' + '));
          if (salary) API.write('설정', 'salary', salary);
          UI.refresh(); UI.toast('수입을 저장했어요'); open();
        }
      });
    }, 'wide');
  }

  // ---------- 카드 ----------
  function cardList() {
    listSheet('카드', [], {
      intro: '카드 이름, 결제일, 이용 기간 시작일을 고칠 수 있어요.',
      groups: [{ title: '쓰는 카드', rows: cards().map(c => ({ id: c.id, title: c.name, sub: `매달 ${c.payDay || '?'}일 결제 · 이용 기간 ${c.cycleStart || 1}일부터` })) }],
      add: '카드 추가', onEdit: cardForm
    });
  }
  function cardForm(id) {
    const list = copy(cards()), cur = id ? list.find(c => c.id === id) : { name: '', payDay: 15, cycleStart: 1 };
    const used = id && (API.list('내역').some(t => t.method === id) || (st().fixed || []).some(f => f.method === id));
    formSheet(id ? '카드 고치기' : '카드 추가', [
      { k: 'name', label: '카드 이름', type: 'text', ph: '예: 국민카드' },
      { k: 'payDay', label: '매달 결제일', type: 'day' },
      { k: 'cycleStart', label: '이용 기간 시작일', type: 'day', hint: '1이면 지난달 1일~말일 쓴 돈이 이번 달에 나가요. 카드 명세서의 ‘이용 기간’을 보세요' },
      { k: 'used', label: '이 카드로 쓴 기록이나 고정지출이 있어서 지울 수 없어요.', type: 'note', show: () => !!used }
    ], cur, {
      backLabel: '카드', back: cardList,
      onSave: x => {
        if (!String(x.name || '').trim()) return '카드 이름을 넣어 주세요';
        if (!(+x.payDay >= 1 && +x.payDay <= 31)) return '결제일은 1~31 사이로 넣어 주세요';
        const out = { ...cur, name: x.name.trim(), payDay: +x.payDay, cycleStart: +x.cycleStart || 1 };
        if (id) list[list.findIndex(c => c.id === id)] = out;
        else { out.id = newId('card'); out.color = PALETTE[list.length % PALETTE.length]; list.push(out); }
        save('cards', list, id ? '고쳤어요' : '카드를 넣었어요'); cardList();
      },
      delLabel: '카드 지우기',
      onDelete: id && !used ? () => { save('cards', list.filter(c => c.id !== id), '지웠어요'); cardList(); } : null
    });
  }

  // ---------- 이번 달 예산 ----------
  function planList() {
    const { fmt } = UI, list = st().plans || [];
    listSheet('이번 달 예산', [], {
      intro: '카드로 그때그때 쓰는 돈의 한 달 예산이에요. 홈 ‘이번 달 예산’에서 얼마 남았는지 보여요.',
      groups: [{ title: '예산', rows: list.map(p => ({ id: p.id, title: p.name, sub: `분류 ${p.category}${p.active === false ? ' · 쉬는 중' : ''}`, right: fmt(+p.amount || 0), muted: p.active === false })) }],
      add: '예산 추가', onEdit: planForm
    });
  }
  function planForm(id) {
    const list = copy(st().plans || []), cur = id ? list.find(p => p.id === id) : { name: '', amount: '', category: '', method: 'card', active: true };
    formSheet(id ? '예산 고치기' : '예산 추가', [
      { k: 'name', label: '이름', type: 'text', ph: '예: 외식' },
      { k: 'amount', label: '한 달 예산', type: 'money' },
      { k: 'category', label: '어느 분류의 돈인가요', type: 'select', options: () => catNames().map(c => [c, c]) },
      { k: 'stop', label: '쉬는 중', type: 'toggle', show: () => !!id }
    ], { ...cur, stop: cur.active === false }, {
      backLabel: '이번 달 예산', back: planList,
      onSave: x => {
        if (!String(x.name || '').trim()) return '이름을 넣어 주세요';
        if (!(+x.amount > 0)) return '예산 금액을 넣어 주세요';
        if (!x.category) return '분류를 골라 주세요';
        const out = { ...cur, name: x.name.trim(), amount: +x.amount, category: x.category, active: !x.stop };
        if (id) list[list.findIndex(p => p.id === id)] = out; else { out.id = newId('p'); list.push(out); }
        save('plans', list, '저장했어요'); planList();
      },
      onDelete: id ? () => { save('plans', list.filter(p => p.id !== id), '지웠어요'); planList(); } : null
    });
  }

  // ---------- 분류 · 기타 정리 ----------
  function catHome() {
    const { esc, fmt, ICON } = UI;
    const etc = API.list('내역').filter(t => !t.deleted && t.source !== 'income' && (t.category || '기타') === '기타');
    const groups = {};
    etc.forEach(t => { const k = Calc.normMerchant(t.memo); (groups[k] ??= { memo: t.memo || '(이름 없음)', rows: [], sum: 0 }); groups[k].rows.push(t); groups[k].sum += +t.amount || 0; });
    const list = Object.entries(groups).sort((a, b) => b[1].rows.length - a[1].rows.length || b[1].sum - a[1].sum);
    const cats = st().categories || Calc.DEFAULT_CATS.map(n => ({ name: n, kind: '선택' }));
    let pick = null;
    const draw = el => {
      el.querySelector('#etc').innerHTML = list.length ? list.map(([k, g]) => `<li><button data-s="pick" data-k="${esc(k)}" aria-expanded="${pick === k}">
          <span class="tt"><b>${esc(g.memo)}</b><small>${g.rows.length}건</small></span><span class="num r">${fmt(g.sum)}</span></button>
          ${pick === k ? `<div class="chips wrap-chips">${catNames().filter(c => c !== '기타').map(c => `<button class="chip" data-s="set" data-k="${esc(k)}" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}</li>`).join('')
        : '<li class="empty" style="padding:14px 0">‘기타’로 남은 기록이 없어요. 다 정리됐어요!</li>';
    };
    UI.openSheet('분류 정리', `<div class="stack">
      <button class="back-link" data-s="home">${ICON('left', 'sm')}설정</button>
      <div><h4 class="set-h">‘기타’로 들어간 기록 (${etc.length}건)</h4>
      <p class="muted" style="margin:0 0 8px;font-size:13px;line-height:1.6">사용처를 누르고 분류를 고르면 같은 사용처 기록이 한꺼번에 바뀌어요. 다음 명세서부터도 그 분류로 들어가요.</p>
      <ul class="set-list etc" id="etc"></ul></div>
      <div><h4 class="set-h">분류 목록</h4><p class="muted" style="margin:0 0 8px;font-size:13px">눌러서 필수 ↔ 선택을 바꿀 수 있어요. 선택 지출은 분석에서 ‘줄일 수 있는 돈’으로 봐요.</p>
      <div class="chips wrap-chips">${cats.map((c, i) => `<button class="chip" data-s="kind" data-i="${i}">${esc(c.name)} <small class="muted">${esc(c.kind || '선택')}</small></button>`).join('')}</div></div>
      <div class="row2"><input class="inp" id="newCat" placeholder="새 분류 이름"><button class="btn" data-s="newcat">${ICON('plus', 'sm')}추가</button></div></div>`, el => {
      draw(el);
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-s]'); if (!b) return;
        const a = b.dataset.s;
        if (a === 'home') open();
        if (a === 'pick') { pick = pick === b.dataset.k ? null : b.dataset.k; draw(el); }
        if (a === 'set') {
          const g = groups[b.dataset.k], cat = b.dataset.v;
          API.writeMany('내역', g.rows.map(t => ({ ...t, category: cat })));
          const rules = { ...(st().rules || {}) }; rules[b.dataset.k] = cat;
          API.write('설정', 'rules', rules);
          const i = list.findIndex(([k]) => k === b.dataset.k); if (i >= 0) list.splice(i, 1);
          pick = null; UI.refresh(); UI.toast(`${g.rows.length}건을 ‘${cat}’로 바꿨어요`); draw(el);
          el.querySelector('.set-h').textContent = `‘기타’로 들어간 기록 (${list.reduce((s, [, x]) => s + x.rows.length, 0)}건)`;
        }
        if (a === 'kind') {
          const c = copy(cats); const x = c[+b.dataset.i]; x.kind = x.kind === '필수' ? '선택' : '필수';
          save('categories', c, `‘${x.name}’은 이제 ${x.kind} 지출이에요`); catHome();
        }
        if (a === 'newcat') {
          const n = el.querySelector('#newCat').value.trim();
          if (!n) { UI.toast('새 분류 이름을 넣어 주세요'); return; }
          if (catNames().includes(n)) { UI.toast('이미 있는 분류예요'); return; }
          const c = copy(cats); c.splice(Math.max(0, c.length - 1), 0, { name: n, kind: '선택' });   // ‘기타’ 앞에
          save('categories', c, `‘${n}’ 분류를 만들었어요`); catHome();
        }
      });
    }, 'wide');
  }

  // ---------- 대출 ----------
  const KIND = [['insurance', '보험계약대출'], ['bank', '은행 대출'], ['card', '카드론'], ['etc', '기타']];
  function loanList() {
    const { fmt } = UI, list = (st().loans || []).filter(L => L.kind !== 'car');
    listSheet('대출', [], {
      intro: '자동차 할부는 고정지출에서 고쳐요. 새로 대출을 받았으면 ‘대출 추가’로 넣어 주세요 — 받은 돈은 이번 달 수입에, 매달 이자는 고정지출에 같이 들어가요.',
      groups: [{ title: '대출 목록', rows: list.map(L => ({ id: L.id, title: L.name, sub: L.interestMonthly ? `이자 매달 ${fmt(L.interestMonthly)}원` : (L.monthly ? `매달 ${fmt(L.monthly)}원` : ''), right: fmt(+L.balance || +L.principal || 0) })) }],
      add: '대출 추가', onEdit: loanForm
    });
  }
  function loanForm(id) {
    const s = st(), loans = copy(s.loans || []), fixed = copy(s.fixed || []);
    const cur = id ? loans.find(L => L.id === id) : { name: '', kind: 'insurance', balance: '', interestMonthly: '', rate: '' };
    const fx = cur.fixedId ? fixed.find(f => f.id === cur.fixedId) : null;
    const v = { ...cur, day: fx ? fx.day : 1, method: fx ? fx.method : 'cash', addIncome: !id, received: thisMonth() };
    formSheet(id ? '대출 고치기' : '대출 추가', [
      { k: 'name', label: '이름', type: 'text', ph: '예: 한화생명 보험계약대출' },
      { k: 'kind', label: '종류', type: 'select', options: () => KIND },
      { k: 'balance', label: id ? '지금 남은 원금' : '빌린 돈', type: 'money' },
      { k: 'rate', label: '연 이자율 (%)', type: 'number', ph: '예: 4.3', hint: '모르면 비워 두고 아래 매달 이자만 넣어도 돼요' },
      { k: 'interestMonthly', label: '매달 내는 이자', type: 'money', hint: '비워 두면 빌린 돈 × 이자율 ÷ 12로 계산해요' },
      { k: 'day', label: '이자 내는 날', type: 'day' },
      { k: 'method', label: '이자 내는 방법', type: 'select', options: () => [['cash', '현금·이체'], ...cards().map(c => [c.id, c.name])] },
      { k: 'addIncome', label: '받은 돈을 수입에 더하기', type: 'toggle', show: () => !id, hint: '이번 달 부족한 돈을 메우는 데 쓰면 켜 두세요' },
      { k: 'received', label: '받은 달', type: 'month', show: x => !id && x.addIncome },
      { k: 'note', label: '메모', type: 'text' }
    ], v, {
      backLabel: '대출', back: loanList,
      onSave: x => {
        if (!String(x.name || '').trim()) return '이름을 넣어 주세요';
        if (!(+x.balance > 0)) return id ? '남은 원금을 넣어 주세요' : '빌린 돈을 넣어 주세요';
        const rate = num(x.rate);
        const interest = +x.interestMonthly > 0 ? +x.interestMonthly : rate ? Math.round(+x.balance * rate / 1200) : 0;
        const out = clean({ ...cur, name: x.name.trim(), kind: x.kind, balance: +x.balance, balanceMonth: thisMonth(), total: id ? (+cur.total || +x.balance) : +x.balance, rate: rate, interestMonthly: interest || '', note: x.note });
        if (!id) out.id = newId('l');
        // 매달 이자 = 고정지출 한 줄 (정산에 한 번만 빠지게)
        const fid = out.fixedId || ('li_' + out.id);
        const fRow = clean({ ...(fx || {}), id: fid, name: `${out.name} 이자`, amount: interest, day: +x.day || 1, method: x.method || 'cash', category: '저축·상환', active: interest > 0, from: (fx && fx.from) || (!id && x.addIncome ? addM(x.received || thisMonth(), 1) : thisMonth()) });
        if (interest > 0 || fx) {
          out.fixedId = fid;
          const i = fixed.findIndex(f => f.id === fid); if (i >= 0) fixed[i] = fRow; else fixed.push(fRow);
          API.write('설정', 'fixed', fixed);
        }
        if (id) loans[loans.findIndex(L => L.id === id)] = out; else loans.push(out);
        API.write('설정', 'loans', loans);
        if (!id && x.addIncome) {
          const ex = copy(s.extraIncome || []);
          ex.push({ id: 'x_' + out.id, month: x.received || thisMonth(), amount: +x.balance, name: `${out.name} 받은 돈` });
          API.write('설정', 'extraIncome', ex);
        }
        UI.refresh(); UI.toast(id ? '고쳤어요' : '대출을 넣었어요. 이자는 고정지출에도 들어갔어요', 3500); loanList();
      },
      delLabel: '다 갚았어요 (목록에서 빼기)',
      onDelete: id ? () => {
        API.write('설정', 'loans', loans.filter(L => L.id !== id));
        if (cur.fixedId) API.write('설정', 'fixed', fixed.map(f => f.id === cur.fixedId ? { ...f, active: false, until: thisMonth() } : f));
        UI.refresh(); UI.toast('대출 목록에서 뺐어요. 이자 고정지출도 멈췄어요', 3500); loanList();
      } : null
    });
  }
  const addM = (ym, k) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + k, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

  // ---------- 모으는 통장 ----------
  function savingsList() {
    const { fmt } = UI, list = st().savings || [];
    listSheet('모으는 통장', [], {
      intro: '입금할 때 사용처에 ‘알아보는 말’(예: 청약)을 넣고 분류를 저축·상환으로 하면 모은 돈에 더해져요.',
      groups: [{ title: '통장', rows: list.map(x => ({ id: x.id, title: x.name, sub: `알아보는 말 ‘${x.match || ''}’ · 매달 ${fmt(+x.monthly || 0)}원`, right: fmt(+x.base || 0) })) }],
      add: '통장 추가', onEdit: savingsForm
    });
  }
  function savingsForm(id) {
    const list = copy(st().savings || []), cur = id ? list.find(x => x.id === id) : { name: '', base: '', baseCount: '', monthly: '', match: '', baseDate: today() };
    formSheet(id ? '통장 고치기' : '통장 추가', [
      { k: 'name', label: '이름', type: 'text' },
      { k: 'base', label: '기준일까지 모은 돈', type: 'money' },
      { k: 'baseCount', label: '기준일까지 회차 (없으면 비워 두기)', type: 'day' },
      { k: 'monthly', label: '매달 넣으려는 돈', type: 'money' },
      { k: 'match', label: '알아보는 말', type: 'text', ph: '예: 청약', hint: '입금 기록의 사용처에 이 말이 들어 있으면 모은 돈에 더해요' },
      { k: 'note', label: '메모', type: 'text' }
    ], cur, {
      backLabel: '모으는 통장', back: savingsList,
      onSave: x => {
        if (!String(x.name || '').trim()) return '이름을 넣어 주세요';
        if (!String(x.match || '').trim()) return '알아보는 말을 넣어 주세요';
        const changedBase = !id || +x.base !== +cur.base;
        const out = clean({ ...cur, name: x.name.trim(), base: +x.base || 0, baseCount: num(x.baseCount), monthly: +x.monthly || 0, match: x.match.trim(), note: x.note, baseDate: changedBase ? today() : cur.baseDate });
        if (id) list[list.findIndex(s => s.id === id)] = out; else { out.id = newId('s'); list.push(out); }
        save('savings', list, '저장했어요'); savingsList();
      },
      onDelete: id ? () => { save('savings', list.filter(s => s.id !== id), '지웠어요'); savingsList(); } : null
    });
  }

  window.OBYE_SETTINGS = { open: ui => { UI = ui; open(); } };
})();
