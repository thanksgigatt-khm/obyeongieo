// 구글 시트(Apps Script 웹 앱)와 주고받기 (명세서 3장·5장).
// - 로그인하면 토큰만 이 기기 localStorage에 둔다(비밀번호는 저장하지 않음).
// - 가계부 데이터는 화면 메모리에만 둔다. 아직 시트에 못 보낸 입력만 잠깐 이 기기에 두었다가, 보내면 바로 지운다.
// - 앱이 열려 있으면 30초마다, 화면이 다시 보일 때마다 바뀐 것만 받아 온다.
(function () {
  const CFG = window.OBYE_CONFIG || {};
  const TABS = ['내역', '설정', '참았어요', '업로드기록'];
  const LS = {
    get(k) { try { return JSON.parse(localStorage.getItem('obye.' + k)); } catch (e) { return null; } },
    set(k, v) { try { if (v == null) localStorage.removeItem('obye.' + k); else localStorage.setItem('obye.' + k, JSON.stringify(v)); } catch (e) { /* 저장 못 해도 동작 */ } }
  };

  const data = {}; TABS.forEach(t => { data[t] = new Map(); });
  let since = 0, timer = null, running = null, loaded = false, online = true;
  let pending = LS.get('pending') || [];       // 시트에 아직 못 보낸 쓰기
  const listeners = [];
  const emit = (type, info) => listeners.forEach(fn => { try { fn(type, info); } catch (e) { /* 화면 오류가 동기화를 멈추지 않게 */ } });

  const token = () => LS.get('token');
  // 문제 찾기용 기록: 단계 이름·건수·오류 코드만 (금액·가맹점은 남기지 않음), 최근 60개
  function log(msg) {
    const l = LS.get('log') || [];
    l.push(new Date().toLocaleTimeString('ko-KR') + ' ' + msg);
    LS.set('log', l.slice(-60));
  }
  let failed = 0;
  const savePending = () => LS.set('pending', pending.length ? pending : null);

  async function post(body) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 25000);
    try {
      const r = await fetch(CFG.api, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal });
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function login(pw) {
    let r;
    try { r = await post({ action: 'login', pw }); } catch (e) { return { ok: false, error: 'network' }; }
    if (r.ok) { LS.set('token', r.token); LS.set('role', r.role); }
    return r;
  }

  function clearLocal() {
    LS.set('token', null); LS.set('role', null);
    pending = []; savePending();
    since = 0; loaded = false;
    TABS.forEach(t => data[t].clear());
    stop();
  }
  async function logout() {
    const tk = token();
    clearLocal();
    if (tk) { try { await post({ action: 'logout', token: tk }); } catch (e) { /* 이미 로컬에서는 나감 */ } }
  }
  function expired() { clearLocal(); emit('logout'); }

  function apply(doc) {
    const m = data[doc.tab]; if (!m) return;
    if (doc.deleted || doc.data == null) m.delete(doc.id);
    else m.set(doc.id, doc.data);
  }

  async function flush() {
    while (pending.length) {
      const w = pending[0];
      const what = `${w.action} ${w.tab}${w.rows ? ' ' + w.rows.length + '줄' : ''}`;
      let r;
      try { r = await post(Object.assign({}, w, { token: token() })); }
      catch (e) { log(`보내기 실패(연결) ${what}: ${e.name || e.message}`); throw e; }
      if (!r || !r.ok) {
        const code = (r && r.error) || 'no_reply';
        log(`시트가 거절 ${what}: ${code}`);
        if (code === 'login_required') { expired(); return false; }
        if (code === 'busy') throw new Error('busy');
        pending.shift(); savePending();               // 보기 전용·잘못된 요청은 버림
        failed++;
        emit('error', code);
        continue;
      }
      log(`저장됨 ${what}`);
      pending.shift(); savePending();
    }
    return true;
  }

  async function pull() {
    const url = CFG.api + '?token=' + encodeURIComponent(token()) + '&since=' + since;
    const r = await (await fetch(url)).json();
    if (!r.ok) { if (r.error === 'login_required') { expired(); return false; } throw new Error(r.error); }
    r.docs.forEach(apply);
    // 아직 못 보낸 내 입력이 받아 온 옛 값에 덮이지 않게 다시 얹는다
    pending.forEach(w => { if (w.action === 'set') data[w.tab].set(w.id, w.data); else if (w.action === 'del') data[w.tab].delete(w.id); });
    since = r.now;
    if (r.role) LS.set('role', r.role);
    return true;
  }

  function sync() {
    if (!CFG.api || !token()) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      try {
        const had = pending.length;
        failed = 0;
        if (await flush() && await pull()) {
          loaded = true;
          if (!online) { online = true; emit('online'); }
          emit('change');
          if (had && !pending.length && !failed) emit('saved');      // 못 보낸 것이 하나도 빠짐없이 시트에 들어감
        }
      } catch (e) {
        log('동기화 오류: ' + (e.name || '') + ' ' + (e.message || ''));
        if (online) { online = false; emit('offline'); }
      } finally {
        running = null;
        if (pending.length && online && token()) setTimeout(sync, 1000);
      }
    })();
    return running;
  }

  function onVisible() { if (document.visibilityState === 'visible') sync(); }
  function start() {
    stop();
    sync();
    timer = setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 30000);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', sync);
  }
  function stop() {
    if (timer) clearInterval(timer); timer = null;
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('online', sync);
  }

  // 화면에서 바로 반영하고, 시트에는 뒤에서 보낸다
  function write(tab, id, obj) {
    data[tab].set(id, obj);
    pending.push({ action: 'set', tab, id, data: obj }); savePending();
    emit('change'); sync();
  }
  // 여러 줄을 한꺼번에 (데이터 가져오기·명세서 올리기). 시트에는 400줄씩 나눠 보낸다.
  function writeMany(tab, rows) {
    rows.forEach(r => data[tab].set(r.id, r));
    for (let i = 0; i < rows.length; i += 400) pending.push({ action: 'bulk', tab, rows: rows.slice(i, i + 400) });
    savePending();
    emit('change'); sync();
  }
  function remove(tab, id) {
    data[tab].delete(id);
    pending.push({ action: 'del', tab, id }); savePending();
    emit('change'); sync();
  }

  // 알림 같은 바로 답이 필요한 요청 (시트 탭에는 쓰지 않음)
  async function call(body) {
    try {
      const r = await post(Object.assign({}, body, { token: token() }));
      if (r && r.error === 'login_required') expired();
      return r || { ok: false, error: 'no_reply' };
    } catch (e) { return { ok: false, error: 'network' }; }
  }

  window.API = {
    enabled: () => !!CFG.api, call,
    token, role: () => LS.get('role'),
    login, logout, start, stop, sync, write, writeMany, remove,
    list: tab => [...(data[tab] || new Map()).values()],
    settings: () => Object.fromEntries(data['설정']),
    loaded: () => loaded, online: () => online, pendingCount: () => pending.length, log,
    on: fn => listeners.push(fn)
  };
})();
