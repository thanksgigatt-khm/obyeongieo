// 카드 명세서 읽기 (명세서 7장). 파일은 기기 안에서만 읽고, 여기서는 표(행·칸)만 다룬다.
// - htmlRows: 현대·신한처럼 '엑셀 확장자인 HTML 표' 파일을 행 배열로 (rowspan·colspan 맞춤)
// - parse: 행 배열 → 카드사·청구 월·내역
// - plan: 내역을 이미 있는 가계부와 비교해 새로 넣을 것 / 건너뛸 것 / 고정지출과 맞춘 것을 정한다
// 브라우저에서는 window.Statement, 테스트(node)에서는 require.
(function (root, factory) {
  const api = factory(typeof require === 'function' && typeof module === 'object' ? require('./calc.js') : root.Calc);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Statement = api;
})(typeof self !== 'undefined' ? self : this, function (Calc) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const addYM = Calc.addYM, monthDiff = Calc.monthDiff;

  // ---------- HTML 표 → 행 ----------
  const decodeEnt = s => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));
  function htmlRows(html) {
    const out = [];
    const tables = html.split(/<table[\s>]/i);
    for (const tb of tables) {
      const pend = [];                              // 칸마다 위에서 내려온 rowspan 남은 수
      const trRx = /<tr[\s>]([\s\S]*?)<\/tr\s*>/gi;
      let m;
      while ((m = trRx.exec(tb))) {
        const row = [];
        let col = 0;
        const skipBusy = () => { while (pend[col] > 0) { row[col] = ''; pend[col]--; col++; } };
        const tdRx = /<t([dh])((?:\s[^>]*)?)>([\s\S]*?)<\/t\1\s*>/gi;
        let c;
        while ((c = tdRx.exec(m[1]))) {
          skipBusy();
          const text = decodeEnt(c[3].replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).replace(/[ \t\r]+/g, ' ').replace(/\n\s*/g, '\n').trim();
          const cs = +((c[2].match(/colspan\s*=\s*["']?(\d+)/i) || [])[1] || 1);
          const rs = +((c[2].match(/rowspan\s*=\s*["']?(\d+)/i) || [])[1] || 1);
          for (let k = 0; k < cs; k++) { row[col + k] = k ? '' : text; if (rs > 1) pend[col + k] = rs - 1; }
          col += cs;
        }
        for (let k = col; k < pend.length; k++) if (pend[k] > 0) { row[k] = ''; pend[k]--; }
        out.push(Array.from(row, v => v == null ? '' : v));
      }
      out.push([]);                                  // 표 사이 구분
    }
    return out;
  }

  // ---------- 숫자·날짜 ----------
  const num = v => {
    if (typeof v === 'number') return v;
    const s = String(v == null ? '' : v).replace(/[,\s원₩]/g, '');
    return /^-?\d+(\.\d+)?$/.test(s) ? +s : null;
  };
  function parseDate(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) {          // 엑셀 날짜 일련번호
      const d = new Date(Date.UTC(1899, 11, 30) + v * 86400000);
      return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
    }
    const s = String(v == null ? '' : v).trim();
    let m;
    if ((m = s.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일$/))) return [+m[1], +m[2], +m[3]];
    if ((m = s.match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})\.?$/))) return [+m[1], +m[2], +m[3]];
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})$/))) return [+m[1], +m[2], +m[3]];
    if ((m = s.match(/^(\d{2})[.\-/](\d{1,2})[.\-/](\d{1,2})$/))) return [2000 + +m[1], +m[2], +m[3]];
    if ((m = s.match(/^(\d{1,2})[.\-/](\d{1,2})$/))) return [null, +m[1], +m[2]];   // 우리카드: 연도 없음
    return null;
  }
  const ymOfParts = (y, m) => `${y}-${pad(m)}`;

  // ---------- 칸 이름 ----------
  const COLS = {
    date: /^(이용일|거래일자|이용일자|매출일)$/,
    card: /^(이용카드|이용구분)$/,
    merchant: /가맹점/,
    use: /^(이용금액|거래금액)/,
    months: /^(할부기간|할부개월|이용개월|개월|할부\/회차)$/,
    round: /^(회차|청구회차)$/,
    principal: /^(원금|결제원금|결제 금액|결제금액)$/,
    fee: /수수료/,
    kind: /^(매출구분|거래구분)$/
  };
  function mapHeader(head, sub) {
    const names = head.map((h, i) => String((sub && sub[i]) || h || '').replace(/\s*\n\s*/g, ' ').trim());
    const col = {};
    names.forEach((n, i) => { for (const k in COLS) if (col[k] == null && COLS[k].test(n)) col[k] = i; });
    return col;
  }
  const isHeader = r => r.some(c => COLS.date.test(String(c).trim())) && r.some(c => COLS.merchant.test(String(c)));

  function detectCompany(rows, fileName) {
    const flat = rows.slice(0, 40).map(r => r.join('|')).join('\n');
    if (/마이신한|이번달 납부금액|신한/.test(flat) || /신용카드\)\.xls/.test(fileName || '')) return 'shinhan';
    if (/할부\/회차/.test(flat) && /결제원금/.test(flat)) return 'hyundai';
    if (/매출구분/.test(flat) && /이용가맹점\(은행\)명/.test(flat)) return 'woori';
    if (/총할부금액/.test(flat) || /청구요약/.test(flat)) return 'samsung';
    const f = String(fileName || '').toLowerCase();
    if (/hyundai/.test(f)) return 'hyundai';
    if (/samsung/.test(f)) return 'samsung';
    if (/shinhan/.test(f)) return 'shinhan';
    if (/woori|report/.test(f)) return 'woori';
    return 'unknown';
  }
  const COMPANY = { hyundai: '현대카드', woori: '우리카드', samsung: '삼성카드', shinhan: '신한카드', unknown: '카드' };

  // ---------- 명세서 읽기 ----------
  // today: 'YYYY-MM-DD' (연도 없는 날짜·청구 월 추정에 씀)
  function parse(rows, fileName, today) {
    const company = detectCompany(rows, fileName);
    const top = rows.slice(0, 6).map(r => r.join(' ')).join(' ');
    let billMonth = null, billFrom = null;
    let m = top.match(/(\d{4})\s*년\s*(\d{1,2})\s*월/);
    if (m) { billMonth = ymOfParts(+m[1], +m[2]); billFrom = 'title'; }
    if (!billMonth && (m = String(fileName || '').match(/(\d{4})\s*년\s*(\d{1,2})\s*월/))) { billMonth = ymOfParts(+m[1], +m[2]); billFrom = 'file'; }
    if (!billMonth && (m = String(fileName || '').match(/(20\d{2})(\d{2})\d{2}/))) { billMonth = ymOfParts(+m[1], +m[2]); billFrom = 'file'; }
    let predicted = /예정/.test(top) || /예정/.test(fileName || '');

    const items = [], totals = [];
    let col = null, skippedZero = 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].map(c => (typeof c === 'string' ? c.trim() : c));
      if (!r.length || r.every(c => c === '' || c == null)) continue;
      if (isHeader(r)) {
        const next = rows[i + 1] || [];
        const hasSub = !parseDate(next[0]) && next.some(c => /^(원금|회차|수수료|수수료\(이자\))$/.test(String(c).trim()));
        col = mapHeader(r, hasSub ? next : null);
        if (col.card == null || col.merchant == null || (col.use == null && col.principal == null)) col = null;   // 할인·취소 표 등은 읽지 않음
        if (hasSub) i++;
        continue;
      }
      if (!col) continue;
      const line = r.join(' ');
      if (/합\s*계|소\s*계/.test(line)) {
        if (col.principal != null && num(r[col.principal]) != null) totals.push({ grand: /총\s*합\s*계/.test(line), principal: num(r[col.principal]) });
        continue;
      }
      const d = parseDate(r[col.date]);
      const merchant = String(r[col.merchant] || '').replace(/\s+/g, ' ').trim();
      const card = String(r[col.card] || '').replace(/\s+/g, '').trim();
      const use = col.use != null ? num(r[col.use]) : null;
      const principal = col.principal != null ? num(r[col.principal]) : null;
      const fee = col.fee != null ? (num(r[col.fee]) || 0) : 0;
      const kind = col.kind != null ? String(r[col.kind] || '').trim() : '';
      if (!merchant || (use == null && principal == null)) continue;
      // 날짜 없이 카드·가맹점·금액만 있는 줄 = 연회비 (신한)
      const annualFee = !d && !!card;
      if (!d && !annualFee) continue;
      let months = 1, k = 1;
      const mv = col.months != null ? String(r[col.months] || '').trim() : '';
      let mm;
      if ((mm = mv.match(/^(\d+)\s*\/\s*(\d+)$/))) { months = +mm[1]; k = +mm[2]; }
      else if (num(mv)) months = num(mv);
      if (col.round != null && num(r[col.round])) k = num(r[col.round]);
      if (/할부/.test(kind) && months < 2) months = Math.max(months, 2);
      months = Math.max(1, months); k = Math.min(Math.max(1, k), months);
      const foreign = /국외|해외/.test(kind);
      let amount;
      if (months > 1) amount = use != null ? use : principal;
      else {
        amount = principal != null ? principal : use;
        if (principal === 0) { skippedZero++; continue; }        // 쿠폰 등 0원 결제
        if (foreign) amount += fee;
      }
      if (!amount || amount <= 0) continue;
      items.push({
        parts: d, merchant, card, amount: Math.round(amount), months, k,
        principal: principal == null ? null : principal, fee,
        foreign, annualFee: !!annualFee
      });
    }

    // 청구 월을 못 찾았으면(우리카드) 일시불 사용일 중 가장 늦은 달 + 1
    if (!billMonth) {
      const t = today || new Date().toISOString().slice(0, 10);
      const ty = +t.slice(0, 4), tm = +t.slice(5, 7);
      const yms = items.filter(x => x.parts && x.months === 1).map(x => {
        const y = x.parts[0] || (x.parts[1] > tm ? ty - 1 : ty);
        return ymOfParts(y, x.parts[1]);
      }).sort();
      billMonth = yms.length ? addYM(yms[yms.length - 1], 1) : t.slice(0, 7);
      billFrom = 'guess';
    }
    finishDates(items, billMonth);
    // 아직 오지 않은 달의 청구서는 '예정'(더 붙을 수 있음) — 우리카드처럼 파일에 예정 표시가 없어도
    if (today && billMonth > today.slice(0, 7)) predicted = true;
    // 명세서 합계 줄(원금)과 비교용: 이번 달에 내는 원금의 합
    const parsedPrincipal = items.reduce((s, x) => s + (x.principal != null ? x.principal : x.amount), 0);
    const grand = totals.find(t => t.grand);
    const expected = grand ? grand.principal : totals.length ? totals.reduce((s, t) => s + t.principal, 0) : null;
    return {
      company, companyName: COMPANY[company], fileName, billMonth, billFrom, predicted,
      items, skippedZero, cards: [...new Set(items.map(x => x.card).filter(Boolean))],
      check: { expected, got: parsedPrincipal }
    };
  }

  // 청구 월이 정해지면 날짜(연도)와 첫 청구 월을 채운다. 사용자가 청구 월을 바꾸면 다시 부른다.
  function finishDates(items, billMonth) {
    const by = +billMonth.slice(0, 4), bm = +billMonth.slice(5, 7);
    for (const x of items) {
      x.firstBill = addYM(billMonth, -(x.k - 1));
      if (x.annualFee || !x.parts) { x.date = `${addYM(billMonth, -1)}-01`; continue; }
      let [y, mo, da] = x.parts;
      if (!y) {                                     // 연도 없음: 첫 청구 월보다 늦지 않은 가장 가까운 해
        const fb = x.firstBill, fy = +fb.slice(0, 4), fm = +fb.slice(5, 7);
        y = mo > fm ? fy - 1 : fy;
      }
      x.date = `${y}-${pad(mo)}-${pad(da)}`;
    }
    return items;
  }
  function setBillMonth(parsed, ym) { parsed.billMonth = ym; parsed.billFrom = 'user'; finishDates(parsed.items, ym); return parsed; }

  // ---------- 가계부와 맞추기 ----------
  const KEYWORD_CATS = [
    [/우아한형제|배달의민족|배민|요기요|쿠팡이츠|도미노|피자헛|BHC|bhc|교촌|굽네/, '배달'],
    [/쿠팡(?!와우)|네이버페이|NAVER/, '장보기'],      // 우리 집은 쿠팡·네이버로 고기·계란·물 같은 식재료를 삼
    [/11번가|G마켓|지마켓|옥션|SSG\.COM|무신사|오늘의집|알리|테무/, '온라인쇼핑'],
    [/주유|오일|에너지|GS칼텍스|SK에너지|S-OIL|현대오일|도로공사|하이패스|주차|택시|카카오T|코레일|버스/, '주유·교통'],
    [/약국|의원|병원|의료|치과|한의원|메디/, '병원·약국'],
    [/항공|에어|호텔|숙박|야놀자|여기어때|아고다|트립/, '여행'],
    [/학원|교습|에듀|교육|태권도|피아노|미술|수학|영어/, '아이·교육'],
    [/보험|생명|화재|손해/, '보험'],
    [/관리비|도시가스|가스|코웨이|전기|수도|한전/, '관리비·공과금'],
    [/스타벅스|커피|카페|제과|베이커리|빵|파리바게뜨|뚜레쥬르|편의점|GS25|CU|세븐일레븐|이마트24|투썸|이디야|메가|빽다방/, '카페·간식'],
    [/식자재|SSG|이마트|홈플러스|롯데마트|마트|하나로|농협|코스트코|트레이더스|컬리|정육|청과/, '장보기'],
    [/다이소|생활/, '생활용품'],
    [/유플러스|LGU|LG U|SKT|KT|통신|넷플릭스|유튜브|구독|멜론|티빙|왓챠|디즈니|쿠팡와우|Claude|OPENAI|ChatGPT/i, '구독·통신'],
    [/연회비|할부수수료|수수료/, '수수료·연회비']
  ];
  function guessCategory(merchant, ctx) {
    const key = Calc.normMerchant(merchant);
    if (ctx.rules && ctx.rules[key] && ctx.categories.includes(ctx.rules[key])) return ctx.rules[key];
    if (ctx.memoCats && ctx.memoCats[key]) return ctx.memoCats[key];
    for (const [rx, cat] of KEYWORD_CATS) if (rx.test(merchant) && ctx.categories.includes(cat)) return cat;
    return ctx.categories.includes('기타') ? '기타' : ctx.categories[0];
  }

  const dayDiff = (a, b) => Math.round(Math.abs(new Date(a) - new Date(b)) / 86400000);
  const words = s => String(s || '').replace(/[()（）\[\]·_\-/]/g, ' ').split(/\s+/).map(w => w.replace(/비$|요금$|료$/, '')).filter(w => w.length >= 2);

  // ctx: { cards, cardMap{라벨→카드id}, tx(이미 있는 내역), fixed, categories, rules, settings }
  function plan(parsed, cardOfLabel, ctx) {
    const existing = (ctx.tx || []).filter(t => !t.deleted);
    const keys = new Set(existing.map(t => t.importKey || Calc.importKey(t)));
    const memoCats = {};
    existing.slice().sort((a, b) => (a.date < b.date ? -1 : 1)).forEach(t => { if (t.memo) memoCats[Calc.normMerchant(t.memo)] = t.category; });
    const cctx = { ...ctx, memoCats };
    const C = Calc.create({ settings: ctx.settings || { cards: ctx.cards }, tx: [] });
    const usedFixed = new Set();
    const usedManual = new Set();
    const manual = e => e.source === 'manual' && !e.importKey && !usedManual.has(e.id);
    const rows = [];
    const add = (x, extra) => {
      const method = cardOfLabel(x.card);
      const card = (ctx.cards || []).find(c => c.id === method);
      const t = {
        date: x.date, amount: x.amount, method, memo: x.merchant, months: x.months,
        category: x.annualFee || extra.fee ? (ctx.categories.includes('수수료·연회비') ? '수수료·연회비' : guessCategory(x.merchant, cctx)) : guessCategory(x.merchant, cctx),
        unneeded: false, isFixed: false, source: parsed.company
      };
      Object.assign(t, extra.t || {});
      if (card) {
        const want = extra.fee ? parsed.billMonth : x.firstBill;
        if (Calc.billMonth(card, t.date) !== want) t.billOverride = want;
      }
      t.importKey = Calc.importKey(t);
      let status = 'new', why = '';
      if (!method) { status = 'nocard'; why = '카드를 골라 주세요'; }
      else if (keys.has(t.importKey)) { status = 'dup'; why = '이미 있어요'; }
      else {
        // 손으로 넣었거나 옮겨 온 기록: 같은 카드사 카드 + 같은 금액이면 날짜가 조금 달라도 같은 것으로 본다
        // (카드사 안에서 카드를 다르게 골라도 겹치지 않게)
        const peers = new Set([method, ...(ctx.companyCards || [])].filter(Boolean));
        // 명세서가 최종: 직접 적은 기록(manual)과 같은 결제면 그 기록을 명세서 줄로 바꿔 끼운다(replace).
        // 이미 명세서·옮기기로 들어온 줄과 같으면 건너뜀(dup).
        const isNear = e => peers.has(e.method) && Math.round(+e.amount) === t.amount && (+e.months || 1) === t.months && dayDiff(e.date, t.date) <= (t.months > 1 ? 40 : 3);
        const near = existing.find(e => !manual(e) && isNear(e));
        const nearM = !near && existing.find(e => manual(e) && isNear(e));
        const label = e => `${e.date.slice(5).replace('-', '/')} ${e.memo || ''} ${Math.round(+e.amount).toLocaleString('ko-KR')}원`;
        if (near) { status = 'dup'; why = `이미 있어요 (${label(near)})`; }
        else if (nearM) { status = 'replace'; t.replaces = nearM.id; usedManual.add(nearM.id); why = `직접 적은 기록과 같아요 (${label(nearM)}) → 명세서로 바꿔요`; }
        else if (!extra.fee) {
          // 같은 날 같은 카드사, 금액만 조금 다름 → 할인 전 금액으로 적었을 수 있음
          const isSim = e => peers.has(e.method) && e.date === t.date && Math.abs(+e.amount - t.amount) <= Math.max(3000, t.amount * 0.1);
          const simM = existing.find(e => manual(e) && isSim(e));
          const sim = !simM && existing.find(isSim);
          if (simM) { status = 'replace'; t.replaces = simM.id; usedManual.add(simM.id); why = `직접 적은 기록 (${label(simM)})을 명세서 금액으로 바꿔요`; }
          else if (sim) { status = 'similar'; why = `비슷한 기록이 있어요 (${label(sim)}) · 다른 거면 체크`; }
        }
      }
      // 고정지출과 맞추기: matchKeyword 또는 이름이 가맹점에 들어 있음, 아니면 같은 카드·같은 금액·결제일 근처
      if (!extra.fee && status !== 'nocard' && t.months === 1) {
        const U = t.date.slice(0, 7);
        const nm = Calc.normMerchant(t.memo);
        // 맞춤 단어(matchKeyword, '|'로 여러 개)로 찾으면 여러 건이 한 고정지출에 붙을 수 있음 (예: 핸드폰 6회선 → 핸드폰비 한 줄)
        const kw = f => String(f.matchKeyword || '').split('|').map(s => Calc.normMerchant(s.trim())).filter(Boolean);
        const byKw = (ctx.fixed || []).find(f => f.method === method && f.id != null && C.fixedOn(f, U) && kw(f).some(k => nm.includes(k)));
        const cands = byKw ? [byKw] : (ctx.fixed || []).filter(f => f.method === method && f.id != null && !usedFixed.has(f.id) && C.fixedOn(f, U));
        // 이름으로 찾은 것도 금액이 30% 넘게 다르면 맞추지 않음 (예: 여러 회선 합친 통신비 ↔ 회선 하나)
        // '매달 달라요' 표시한 것은 60%까지 같은 것으로 봄
        const close = f => { const fa = C.fixedAmt(f, U); return fa > 0 && Math.abs(fa - t.amount) <= fa * (f.variable ? 0.6 : 0.3); };
        const f = byKw
          || cands.find(f => close(f) && words(f.name).some(w => nm.includes(Calc.normMerchant(w))))
          || cands.find(f => Math.round(C.fixedAmt(f, U)) === t.amount && Math.abs((+f.day || 1) - +t.date.slice(8, 10)) <= 5);
        if (f) {
          usedFixed.add(f.id);
          t.isFixed = true; t.fixedId = f.id;
          if (f.category && ctx.categories.includes(f.category)) t.category = f.category;
          const fa = Math.round(C.fixedAmt(f, U));
          if (!byKw && !f.pct && !f.perWeek && !f.variable && fa !== t.amount) t.fixedChange = { id: f.id, name: f.name, from: fa, to: t.amount };
          t.fixedName = f.name;
          // 고정지출 [기록] 버튼으로 이미 적어 둔 달이면 기본은 넣지 않고 확인받기 (두 번 세지 않게)
          const mine = status === 'new' && existing.find(e => manual(e) && String(e.fixedId) === String(f.id) && String(e.date).slice(0, 7) === U);
          if (mine) { status = 'replace'; t.replaces = mine.id; usedManual.add(mine.id); why = `고정지출로 적은 기록 (${mine.date.slice(5).replace('-', '/')} ${Math.round(+mine.amount).toLocaleString('ko-KR')}원) → 명세서로 바꿔요`; }
        }
      }
      rows.push({ t, status, why });
    };
    for (const x of parsed.items) {
      add(x, {});
      if (x.months > 1 && x.fee > 0) {
        add({ ...x, merchant: `할부수수료 ${x.merchant} (${+parsed.billMonth.slice(5)}월)`, amount: x.fee, months: 1, k: 1, firstBill: parsed.billMonth }, { fee: true });
      }
    }
    // 같은 파일 안에서 같은 키가 두 번이면 두 번째도 넣되 표시
    const seen = {};
    rows.forEach(r => { if (r.status !== 'new') return; const k = r.t.importKey; seen[k] = (seen[k] || 0) + 1; if (seen[k] > 1) r.why = `같은 날 같은 곳 ${seen[k]}번째`; });
    return rows;
  }

  // 확정 명세서의 카드별 이번 달 청구 합계 (할부는 이번 회차 원금 + 수수료, 해외는 수수료 포함). 예정 명세서는 null.
  // allIds: 그 카드사 카드 전부(한 명세서에 함께 나옴) → 이번 달 쓴 게 없는 카드는 0원으로 확정
  function billTotals(parsed, cardOfLabel, allIds) {
    if (parsed.predicted) return null;
    const out = {};
    (allIds || []).forEach(id => { out[id] = 0; });
    for (const x of parsed.items) {
      const id = cardOfLabel(x.card); if (!id) continue;
      const pay = x.months > 1 ? (x.principal || 0) + (x.fee || 0) : x.amount;
      out[id] = (out[id] || 0) + pay;
    }
    return out;
  }

  return { htmlRows, parse, setBillMonth, plan, billTotals, parseDate, num, detectCompany, guessCategory, COMPANY };
});
