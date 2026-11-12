// 9단계: 알림 (명세서 11장).
// - [이 폰에서 알림 받기] → 알림 허락 → Firebase에서 이 폰 주소(토큰)를 받아 시트 '알림기기' 탭에 저장.
// - 언제 보낼지는 설정 'noti'에 저장하고, 실제로 보내는 건 구글 시트(Apps Script)가 15분마다 확인해서 한다.
// - Firebase 설정값은 저장소에 두지 않고, 로그인한 청지기에게만 시트가 알려 준다.
// - 알림 문구에는 금액·가맹점·카드명이 없다.
(function () {
  let UI = null;
  const FB_VER = '10.12.2';
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem('obye.' + k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem('obye.' + k); else localStorage.setItem('obye.' + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 동작 */ } }
  };
  const DEFAULT = {
    evening: { on: true, time: '18:00' },
    weekend: { on: true, time: '11:30', time2: '17:30' },
    payday: { on: true, time: '09:00' },
    sunday: { on: true, time: '21:00' }
  };
  const KINDS = [
    { k: 'evening', t: '퇴근 무렵', s: '평일', note: '오늘 쓸 수 있는 돈 확인' },
    { k: 'weekend', t: '주말 점심·저녁 전', s: '토·일', note: '배달 앱 열기 전에 한 번', two: true },
    { k: 'payday', t: '카드 결제일 3일 전', s: '결제일 3일 전', note: '통장 금액 확인' },
    { k: 'sunday', t: '일요일 주간 점검', s: '일요일', note: '빠진 입력 · 다음 주 장보기' }
  ];
  const prefs = () => {
    const saved = API.settings().noti || {};
    const n = JSON.parse(JSON.stringify(DEFAULT));
    Object.keys(n).forEach(k => Object.assign(n[k], saved[k] || {}));
    return n;
  };

  const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';
  const shortUA = () => {
    const u = navigator.userAgent;
    return (/Android/.test(u) ? 'Android' : /iPhone|iPad/.test(u) ? 'iPhone' : 'PC') + ' · ' + (/SamsungBrowser/.test(u) ? '삼성 인터넷' : /CriOS|Chrome/.test(u) ? 'Chrome' : /Safari/.test(u) ? 'Safari' : '브라우저');
  };

  function loadScript(src) {
    return new Promise((ok, no) => {
      const s = document.createElement('script');
      s.src = src; s.onload = ok; s.onerror = () => no(new Error('sdk'));
      document.head.appendChild(s);
    });
  }
  async function fcmToken(web) {
    if (!(window.firebase && firebase.messaging)) {
      await loadScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-app-compat.js`);
      await loadScript(`https://www.gstatic.com/firebasejs/${FB_VER}/firebase-messaging-compat.js`);
    }
    const cfg = { apiKey: web.apiKey, projectId: web.projectId, messagingSenderId: web.messagingSenderId, appId: web.appId };
    const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
    const reg = await navigator.serviceWorker.ready;
    return firebase.messaging(app).getToken({ vapidKey: web.vapidKey, serviceWorkerRegistration: reg });
  }

  const ERR = {
    push_not_ready: '구글 시트에서 [오병이어] 메뉴 → [알림 준비]를 먼저 해 주세요.',
    network: '인터넷 연결을 확인해 주세요.',
    bad_action: '구글 시트의 Apps Script를 새 코드로 바꾸고 새 버전으로 배포해 주세요.',
    bad_tab: '구글 시트의 Apps Script를 새 코드로 바꾸고 새 버전으로 배포해 주세요.',
    sdk: '알림 도구를 불러오지 못했어요. 잠시 뒤 다시 해 주세요.'
  };
  const errText = code => ERR[code] || `알림을 켜지 못했어요 (${code}). Claude에게 알려 주세요.`;

  async function enable() {
    const p = await Notification.requestPermission();
    if (p !== 'granted') { UI.toast('알림을 허락해야 받을 수 있어요'); return; }
    const info = await API.call({ action: 'pushInfo' });
    if (!info.ok) { UI.toast(errText(info.error), 6000); return; }
    let fcm;
    try { fcm = await fcmToken(info.web); }
    catch (e) { API.log('알림 토큰 실패: ' + (e.code || e.message)); UI.toast(errText(e.message === 'sdk' ? 'sdk' : (e.code || 'token')), 6000); return; }
    const r = await API.call({ action: 'pushRegister', fcm, old: LS.get('pushTok'), ua: shortUA() });
    if (!r.ok) { UI.toast(errText(r.error), 6000); return; }
    LS.set('pushTok', fcm); LS.set('pushAt', Date.now());
    UI.toast('이 폰에서 알림을 받아요. [시험 알림]으로 확인해 보세요', 4000);
  }
  async function disable() {
    const tok = LS.get('pushTok');
    if (tok) await API.call({ action: 'pushUnregister', fcm: tok });
    try { const reg = await navigator.serviceWorker.ready; const s = await reg.pushManager.getSubscription(); if (s) await s.unsubscribe(); } catch (e) { /* 이미 꺼짐 */ }
    LS.set('pushTok', null); LS.set('pushAt', null);
    UI.toast('이 폰에서는 알림을 껐어요');
  }
  async function test() {
    const r = await API.call({ action: 'pushTest', fcm: LS.get('pushTok') });
    UI.toast(r.ok ? '시험 알림을 보냈어요. 몇 초 안에 와요' : errText(r.error), 5000);
  }

  // 이 폰 토큰이 바뀌었을 수 있어서 일주일에 한 번 조용히 다시 확인
  async function refresh() {
    try {
      if (!supported() || API.role() !== 'owner' || Notification.permission !== 'granted') return;
      const old = LS.get('pushTok');
      if (!old || Date.now() - (LS.get('pushAt') || 0) < 7 * 86400000) return;
      const info = await API.call({ action: 'pushInfo' });
      if (!info.ok) return;
      const fcm = await fcmToken(info.web);
      const r = await API.call({ action: 'pushRegister', fcm, old, ua: shortUA() });
      if (r.ok) { LS.set('pushTok', fcm); LS.set('pushAt', Date.now()); }
    } catch (e) { API.log('알림 토큰 다시 확인 실패'); }
  }

  function stateHtml() {
    const { ICON } = UI;
    if (!supported()) {
      if (isIOS() && !standalone()) return `<div class="set-box">아이폰은 Safari에서 <b>공유 → 홈 화면에 추가</b>로 앱을 설치한 뒤, 그 앱을 열어야 알림을 받을 수 있어요. (iOS 16.4 이상)</div>`;
      return `<div class="set-box">이 브라우저에서는 알림을 받을 수 없어요. 갤럭시는 Chrome이나 삼성 인터넷으로 열어 주세요.</div>`;
    }
    if (Notification.permission === 'denied') return `<div class="set-box">알림이 막혀 있어요. 폰 <b>설정 → 애플리케이션 → Chrome(또는 오병이어) → 알림</b>을 켠 뒤 다시 와 주세요.</div>`;
    if (LS.get('pushTok') && Notification.permission === 'granted') return `
      <div class="set-box noti-on">${ICON('bell', 'sm')}<span>이 폰은 알림을 <b>받고 있어요</b></span></div>
      <div class="row2"><button class="btn soft" data-n="test">시험 알림</button><button class="btn ghost" data-n="off">이 폰 알림 끄기</button></div>`;
    return `<button class="btn primary block" data-n="on">${ICON('bell', 'sm')}이 폰에서 알림 받기</button>
      ${isIOS() && !standalone() ? '<p class="muted" style="margin:0;font-size:13px">아이폰은 홈 화면에 추가한 앱에서만 알림이 와요.</p>' : ''}`;
  }

  function open(ui) {
    UI = ui;
    const { esc } = UI;
    const P = prefs();
    const rows = KINDS.map(K => {
      const p = P[K.k];
      const time = (f, v) => `<input class="inp time" type="time" data-k="${K.k}" data-f="${f}" value="${esc(v)}" aria-label="${esc(K.t)} 시각">`;
      return `<li class="noti-row">
        <label class="toggle"><span class="tt"><b>${esc(K.t)}</b><small>${esc(K.s)} · ${esc(K.note)}</small></span>
          <input type="checkbox" class="switch" data-k="${K.k}" data-f="on" ${p.on ? 'checked' : ''}></label>
        <div class="noti-times">${time('time', p.time)}${K.two ? time('time2', p.time2) : ''}</div></li>`;
    }).join('');
    const body = `<div class="stack">
      <div id="nState" class="stack">${stateHtml()}</div>
      <h4 class="set-h">언제 알려 드릴까요</h4>
      <ul class="set-list noti-list">${rows}</ul>
      <p class="muted" style="margin:0;font-size:13px;line-height:1.6">알림에는 금액·가게 이름·카드 이름이 나오지 않아요. 숫자는 앱을 열어야 보여요.<br>시간은 15분 안팎으로 늦게 올 수 있어요.</p>
    </div>`;
    UI.openSheet('알림', body, el => {
      const redraw = () => { const s = el.querySelector('#nState'); if (s) s.innerHTML = stateHtml(); };
      el.addEventListener('click', async e => {
        const b = e.target.closest('[data-n]'); if (!b || b.disabled) return;
        b.disabled = true; const label = b.textContent; b.textContent = '잠시만요…';
        try {
          if (b.dataset.n === 'on') await enable();
          else if (b.dataset.n === 'off') await disable();
          else if (b.dataset.n === 'test') await test();
        } finally { b.disabled = false; b.textContent = label; redraw(); }
      });
      el.addEventListener('change', e => {
        const x = e.target; if (!x.dataset.k) return;
        const n = prefs();
        if (x.dataset.f === 'on') n[x.dataset.k].on = x.checked;
        else if (/^\d{1,2}:\d{2}$/.test(x.value)) n[x.dataset.k][x.dataset.f] = x.value;
        else return;
        API.write('설정', 'noti', n);
        UI.toast('저장했어요');
      });
    });
  }

  window.OBYE_NOTI = { open, refresh };
})();
