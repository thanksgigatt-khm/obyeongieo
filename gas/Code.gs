/**
 * 오병이어 — 구글 시트 Apps Script (명세서 3장·5장)
 *
 * 붙여 넣는 곳: 가계부 구글 시트 → 확장 프로그램 → Apps Script → Code.gs 내용을 모두 지우고 이 파일 전체를 붙여 넣기.
 * 처음 한 번: 시트를 새로고침 → 위 메뉴 [오병이어] → [처음 설정] → 비밀번호 2개 입력.
 *   ※ 처음 설정을 다시 실행하면 비밀번호가 바뀌고, 모든 폰이 로그아웃돼요.
 *
 * 개인정보: 데이터는 이 시트에만 있어요. 이 코드는 외부로 아무것도 보내지 않아요.
 * 비밀번호는 평문으로 저장하지 않고 '솔트 + SHA-256 해시'로만 스크립트 속성에 저장해요.
 */

const TABS = {
  '내역': ['id', 'date', 'amount', 'method', 'category', 'memo', 'months', 'billOverride', 'unneeded', 'isFixed', 'fixedId', 'source', 'importKey', 'createdAt', 'updated', 'deleted'],
  '설정': ['key', 'json', 'updated'],
  '참았어요': ['id', 'date', 'kind', 'amount', 'memo', 'updated', 'deleted'],
  '업로드기록': ['id', 'at', 'source', 'fileMonth', 'rows', 'added', 'skipped', 'fixedMatched'],
  '알림기기': ['token', 'role', 'createdAt', 'userAgent']
};
const NUM_COLS = ['amount', 'months', 'createdAt', 'updated', 'at', 'rows', 'added', 'skipped', 'fixedMatched'];
const BOOL_COLS = ['unneeded', 'isFixed', 'deleted'];
const READ_TABS = ['내역', '설정', '참았어요', '업로드기록'];      // 앱이 읽는 탭 (알림기기는 읽지 않음)
const WRITE_TABS = ['내역', '설정', '참았어요', '업로드기록'];
const TOKEN_DAYS = 180;
const MAX_FAILS = 5, LOCK_MIN = 10;

// ---------- 메뉴 ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('오병이어')
    .addItem('처음 설정 (탭 만들기 + 비밀번호)', 'setup')
    .addItem('모든 폰 로그아웃', 'logoutAll')
    .addSeparator()
    .addItem('알림 준비 (Firebase 값 넣기)', 'setupPush')
    .addItem('알림 시험 보내기', 'pushTestMenu')
    .addToUi();
}

// ---------- 처음 설정 ----------
function setup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('pw_owner')) {
    const r = ui.alert('이미 설정되어 있어요', '다시 설정하면 비밀번호가 바뀌고 모든 폰이 로그아웃돼요. 계속할까요?', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
  }
  makeTabs_();
  const owner = askPw_(ui, '청지기 비밀번호', '입력·수정할 때 쓰는 비밀번호예요. (4자 이상)');
  if (!owner) return;
  const viewer = askPw_(ui, '함께 보기 비밀번호', '보기만 하는 비밀번호예요. 청지기 비밀번호와 다르게 정해 주세요. (4자 이상)');
  if (!viewer) return;
  if (owner === viewer) { ui.alert('두 비밀번호가 같아요. 처음 설정을 다시 실행해 주세요.'); return; }
  setPw_('owner', owner);
  setPw_('viewer', viewer);
  clearTokens_();
  props.deleteProperty('fail_count'); props.deleteProperty('lock_until');
  ui.alert('설정 끝!', '탭을 만들고 비밀번호를 저장했어요.\n이제 [배포] → [새 배포]로 웹 앱을 만들어 주세요.', ui.ButtonSet.OK);
}

function askPw_(ui, title, msg) {
  const r = ui.prompt(title, msg, ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return null;
  const pw = r.getResponseText().trim();
  if (pw.length < 4) { ui.alert('4자 이상으로 정해 주세요. 처음 설정을 다시 실행해 주세요.'); return null; }
  return pw;
}

function makeTabs_() {
  const ss = SpreadsheetApp.getActive();
  Object.keys(TABS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    const head = TABS[name];
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // 날짜가 자동으로 바뀌지 않게 모든 칸을 글자 형식으로
    sh.getRange(1, 1, sh.getMaxRows(), head.length).setNumberFormat('@');
  });
  const first = ss.getSheetByName('시트1') || ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(first);
}

// ---------- 비밀번호·토큰 ----------
function hash_(text) {
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text, Utilities.Charset.UTF_8);
  return Utilities.base64Encode(bytes);
}
function setPw_(role, pw) {
  const salt = Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('pw_' + role, JSON.stringify({ salt: salt, hash: hash_(salt + pw) }));
}
function checkPw_(pw) {
  const props = PropertiesService.getScriptProperties();
  for (const role of ['owner', 'viewer']) {
    const raw = props.getProperty('pw_' + role);
    if (!raw) continue;
    const p = JSON.parse(raw);
    if (hash_(p.salt + pw) === p.hash) return role;
  }
  return null;
}
function newToken_(role) {
  const token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');   // 무작위 32바이트
  const exp = Date.now() + TOKEN_DAYS * 86400000;
  PropertiesService.getScriptProperties().setProperty('tok_' + hash_(token), JSON.stringify({ role: role, exp: exp }));
  return token;
}
function roleOf_(token) {
  if (!token || typeof token !== 'string') return null;
  const props = PropertiesService.getScriptProperties();
  const key = 'tok_' + hash_(token);
  const raw = props.getProperty(key);
  if (!raw) return null;
  const t = JSON.parse(raw);
  if (t.exp < Date.now()) { props.deleteProperty(key); return null; }
  return t.role;
}
function clearTokens_(onlyExpired) {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  Object.keys(all).forEach(k => {
    if (k.indexOf('tok_') !== 0) return;
    if (!onlyExpired || JSON.parse(all[k]).exp < Date.now()) props.deleteProperty(k);
  });
}
function logoutAll() {
  clearTokens_();
  SpreadsheetApp.getUi().alert('모든 폰이 로그아웃됐어요. 다시 비밀번호로 들어가면 돼요.');
}

function login_(pw) {
  const props = PropertiesService.getScriptProperties();
  const lockUntil = +(props.getProperty('lock_until') || 0);
  if (lockUntil > Date.now()) return { ok: false, error: 'locked', retryAfterMin: Math.ceil((lockUntil - Date.now()) / 60000) };
  const role = typeof pw === 'string' && pw ? checkPw_(pw) : null;
  if (!role) {
    const n = +(props.getProperty('fail_count') || 0) + 1;
    if (n >= MAX_FAILS) { props.setProperty('lock_until', String(Date.now() + LOCK_MIN * 60000)); props.deleteProperty('fail_count'); }
    else props.setProperty('fail_count', String(n));
    return { ok: false, error: 'wrong_password' };
  }
  props.deleteProperty('fail_count');
  clearTokens_(true);
  return { ok: true, token: newToken_(role), role: role };
}

// ---------- 시트 읽기·쓰기 ----------
function sheet_(tab) { return SpreadsheetApp.getActive().getSheetByName(tab); }

function rowToObj_(head, row) {
  const o = {};
  head.forEach((h, i) => {
    let v = row[i];
    if (v === '' || v == null) return;
    if (NUM_COLS.indexOf(h) >= 0) v = Number(v);
    else if (BOOL_COLS.indexOf(h) >= 0) v = v === true || v === 'TRUE' || v === 'true';
    else v = String(v);
    o[h] = v;
  });
  return o;
}
function objToRow_(head, o) {
  return head.map(h => {
    const v = o[h];
    if (v == null) return '';
    if (typeof v === 'boolean') return v ? 'TRUE' : '';
    return String(v);
  });
}

// since(ms) 이후에 바뀐 것만
function readDocs_(since) {
  const docs = [];
  READ_TABS.forEach(tab => {
    const sh = sheet_(tab); if (!sh || sh.getLastRow() < 2) return;
    const head = TABS[tab];
    const rows = sh.getRange(2, 1, sh.getLastRow() - 1, head.length).getValues();
    rows.forEach(r => {
      const o = rowToObj_(head, r);
      const updated = o.updated || o.at || 0;
      if (since && updated <= since) return;
      if (tab === '설정') {
        let data = null; try { data = JSON.parse(o.json || 'null'); } catch (e) { data = null; }
        docs.push({ tab: tab, id: o.key, data: data, updated: updated });
      } else {
        docs.push({ tab: tab, id: o.id, data: o, updated: updated, deleted: !!o.deleted });
      }
    });
  });
  return docs;
}

function idIndex_(sh) {
  const map = {};
  if (sh.getLastRow() < 2) return map;
  sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach((r, i) => { if (r[0] !== '') map[String(r[0])] = i + 2; });
  return map;
}

function prepare_(tab, id, data, now) {
  if (tab === '설정') return { key: id, json: JSON.stringify(data), updated: now };
  const o = Object.assign({}, data, { id: id });
  if (tab === '업로드기록') { o.at = o.at || now; return o; }
  o.updated = now;
  if (tab === '내역' && !o.createdAt) o.createdAt = now;
  return o;
}

function writeRows_(tab, items) {      // items: [{id, data}]
  const sh = sheet_(tab), head = TABS[tab], now = Date.now();
  const idx = idIndex_(sh);
  const append = [];
  items.forEach(it => {
    const id = String(it.id || '').slice(0, 64);
    if (!id) return;
    const row = objToRow_(head, prepare_(tab, id, it.data || {}, now));
    if (idx[id]) sh.getRange(idx[id], 1, 1, head.length).setValues([row]);
    else append.push(row);
  });
  if (append.length) sh.getRange(sh.getLastRow() + 1, 1, append.length, head.length).setNumberFormat('@').setValues(append);
  return now;
}

function deleteRow_(tab, id) {
  const sh = sheet_(tab), head = TABS[tab], now = Date.now();
  const r = idIndex_(sh)[String(id)];
  if (!r) return now;
  if (head.indexOf('deleted') >= 0) {      // 지운 표시만 (다른 폰도 지운 걸 알 수 있게)
    sh.getRange(r, head.indexOf('deleted') + 1).setValue('TRUE');
    sh.getRange(r, head.indexOf('updated') + 1).setValue(String(now));
  } else if (tab === '설정') {
    sh.getRange(r, 2, 1, 2).setValues([['null', String(now)]]);
  } else {
    sh.deleteRow(r);
  }
  return now;
}

// ---------- 웹 앱 ----------
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

function doGet(e) {
  const p = (e && e.parameter) || {};
  const role = roleOf_(p.token);
  if (!role) return json_({ ok: false, error: 'login_required' });
  const now = Date.now();
  return json_({ ok: true, role: role, docs: readDocs_(+p.since || 0), now: now });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, error: 'bad_request' }); }
  if (body.action === 'login') return json_(login_(body.pw));

  const role = roleOf_(body.token);
  if (!role) return json_({ ok: false, error: 'login_required' });
  if (body.action === 'logout') { PropertiesService.getScriptProperties().deleteProperty('tok_' + hash_(body.token)); return json_({ ok: true }); }
  if (role !== 'owner') return json_({ ok: false, error: 'view_only' });
  if (String(body.action).indexOf('push') === 0) return json_(pushAction_(body));
  if (WRITE_TABS.indexOf(body.tab) < 0) return json_({ ok: false, error: 'bad_tab' });

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return json_({ ok: false, error: 'busy' });
  try {
    let at;
    if (body.action === 'set') at = writeRows_(body.tab, [{ id: body.id, data: body.data }]);
    else if (body.action === 'bulk') {
      if (!Array.isArray(body.rows) || body.rows.length > 2000) return json_({ ok: false, error: 'bad_rows' });
      at = writeRows_(body.tab, body.rows.map(r => ({ id: r.id, data: r })));
    }
    else if (body.action === 'del') at = deleteRow_(body.tab, body.id);
    else return json_({ ok: false, error: 'bad_action' });
    return json_({ ok: true, updated: at });
  } finally {
    lock.releaseLock();
  }
}

// ---------- 알림 (명세서 11장) ----------
// Firebase 값은 이 스크립트의 '스크립트 속성'에만 저장해요 (저장소·시트에 넣지 않음).
// 알림 문구에는 금액·가맹점·카드명을 넣지 않아요. 숫자는 앱을 열어야 보여요.
// 15분마다 pushTick이 돌면서, 정해 둔 시각이 지났고 오늘 아직 안 보낸 알림만 보내요.
const TZ = 'Asia/Seoul';
const SA_KEY_FIELD = 'private' + '_key';
const NOTI_DEFAULT = {
  evening: { on: true, time: '18:00' },
  weekend: { on: true, time: '11:30', time2: '17:30' },
  payday: { on: true, time: '09:00' },
  sunday: { on: true, time: '21:00' }
};
const NOTI_TEXT = {
  evening: { body: '청지기님, 퇴근길이에요. 오늘 쓸 수 있는 돈을 확인하고 저녁 메뉴를 정해 볼까요?', go: 'home' },
  weekend: { body: '배달 앱 열기 전에 가계부 먼저 한 번 볼까요? 참았으면 [참았어요]도 눌러 주세요.', go: 'held' },
  payday: { body: '{d}일에 카드 결제가 있어요. 통장에 필요한 금액을 확인해 주세요.', go: 'pay' },
  sunday: { body: '청지기님, 한 주 마무리! 빠진 입력은 없는지, 다음 주 장보기 예산을 확인해 보세요.', go: 'home' }
};

// 한 번 실행은 6분까지라서, 값을 하나 넣을 때마다 바로 저장해요. 시간이 넘어 멈추면 다시 실행하면 이어서 해요.
function setupPush() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('push_sa')) {
    const r = ui.alert('이미 알림 준비가 되어 있어요', '처음부터 다시 넣을까요?', ui.ButtonSet.YES_NO);
    if (r !== ui.Button.YES) return;
    props.deleteProperty('push_tmp');
  }
  let web = JSON.parse(props.getProperty('push_tmp') || '{}');
  const keep = () => props.setProperty('push_tmp', JSON.stringify(web));

  if (!web.apiKey) {
    const a = ui.prompt('알림 준비 1/3 — 웹 앱 설정값',
      'Firebase → 프로젝트 설정 → 일반 → 내 앱 → SDK 설정 및 구성 → [구성]의 { 부터 } 까지를 붙여 넣어 주세요.', ui.ButtonSet.OK_CANCEL);
    if (a.getSelectedButton() !== ui.Button.OK) return;
    const t = a.getResponseText().replace(/\s/g, '');      // 띄어쓰기·줄바꿈을 모두 빼고 찾기
    const pick = k => { const m = t.match(new RegExp(k + '[\'"]?:[\'"]([^\'"]+)')); return m ? m[1] : ''; };
    const w = { apiKey: pick('apiKey'), projectId: pick('projectId'), messagingSenderId: pick('messagingSenderId'), appId: pick('appId') };
    if (!w.apiKey || !w.projectId || !w.messagingSenderId || !w.appId) {
      ui.alert('apiKey · projectId · messagingSenderId · appId를 찾지 못했어요. 메뉴에서 [알림 준비]를 다시 해 주세요.'); return;
    }
    web = w; keep();
  }
  if (!web.vapidKey) {
    const b = ui.prompt('알림 준비 2/3 — 웹 푸시 인증서',
      '1번은 저장했어요.\nFirebase → 프로젝트 설정 → 클라우드 메시징 → 맨 아래 웹 푸시 인증서의 "키 쌍" 값을 붙여 넣어 주세요.', ui.ButtonSet.OK_CANCEL);
    if (b.getSelectedButton() !== ui.Button.OK) return;
    const v = b.getResponseText().replace(/\s/g, '');
    if (!/^[A-Za-z0-9_-]{80,}$/.test(v)) { ui.alert('키 쌍 값이 아닌 것 같아요. 메뉴에서 [알림 준비]를 다시 하면 2번부터 이어서 해요.'); return; }
    web.vapidKey = v; keep();
  }
  const c = ui.prompt('알림 준비 3/3 — 서비스 계정 키',
    '1·2번은 저장했어요.\n받은 키 파일을 메모장으로 열어 Ctrl+A, Ctrl+C로 전체 복사해서 붙여 넣어 주세요. 붙여 넣은 뒤 그 파일은 꼭 지워 주세요.', ui.ButtonSet.OK_CANCEL);
  if (c.getSelectedButton() !== ui.Button.OK) return;
  let sa = null; try { sa = JSON.parse(c.getResponseText()); } catch (e) { sa = null; }
  if (!sa || !sa.client_email || !sa[SA_KEY_FIELD]) { ui.alert('서비스 계정 키 내용이 아닌 것 같아요. 메뉴에서 [알림 준비]를 다시 하면 3번부터 이어서 해요.'); return; }
  if (sa.project_id && sa.project_id !== web.projectId) { ui.alert('1번 설정값과 3번 키가 서로 다른 Firebase 프로젝트예요. 같은 프로젝트에서 받아 주세요.'); return; }
  props.setProperty('push_sa', JSON.stringify({ email: sa.client_email, key: sa[SA_KEY_FIELD] }));
  CacheService.getScriptCache().remove('push_at');
  try { fcmToken_(); } catch (e) { props.deleteProperty('push_sa'); ui.alert('키 확인에 실패했어요: ' + e.message); return; }
  props.setProperty('push_web', JSON.stringify(web));
  props.deleteProperty('push_tmp');
  ScriptApp.getProjectTriggers().forEach(tr => { if (tr.getHandlerFunction() === 'pushTick') ScriptApp.deleteTrigger(tr); });
  ScriptApp.newTrigger('pushTick').timeBased().everyMinutes(15).create();
  ensureDeviceTab_();
  ui.alert('알림 준비 끝!', '이제 폰 앱 → 더보기 → 알림에서 [이 폰에서 알림 받기]를 눌러 주세요.', ui.ButtonSet.OK);
}

function pushTestMenu() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = sendAll_({ body: '알림 시험이에요. 정해 둔 시간에 이렇게 알려 드릴게요.', go: 'home', tag: 'test' });
    ui.alert(r.total ? '알림 기기 ' + r.total + '대 중 ' + r.sent + '대에 보냈어요.' : '알림 받는 폰이 아직 없어요. 폰 앱 → 더보기 → 알림에서 [이 폰에서 알림 받기]를 눌러 주세요.');
  } catch (e) { ui.alert('보내지 못했어요: ' + e.message); }
}

// 구글 접속 열쇠 (서비스 계정으로 서명, 50분 동안 다시 씀)
function fcmToken_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('push_at'); if (hit) return hit;
  const sa = JSON.parse(PropertiesService.getScriptProperties().getProperty('push_sa') || 'null');
  if (!sa) throw new Error('알림 준비가 안 됐어요');
  const b64 = s => Utilities.base64EncodeWebSafe(s).replace(/=+$/, '');
  const now = Math.floor(Date.now() / 1000);
  const head = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64(JSON.stringify({ iss: sa.email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64(Utilities.computeRsaSha256Signature(head + '.' + claim, sa.key));
  const r = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post', muteHttpExceptions: true,
    payload: { grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }
  });
  const j = JSON.parse(r.getContentText() || '{}');
  if (!j.access_token) throw new Error(j.error_description || j.error || ('응답 ' + r.getResponseCode()));
  cache.put('push_at', j.access_token, 3000);
  return j.access_token;
}

function ensureDeviceTab_() {
  let sh = sheet_('알림기기');
  if (!sh) {
    sh = SpreadsheetApp.getActive().insertSheet('알림기기');
    sh.getRange(1, 1, 1, TABS['알림기기'].length).setValues([TABS['알림기기']]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}
function devices_() {
  const sh = sheet_('알림기기'); if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .map((r, i) => ({ token: String(r[0]), role: String(r[1]), row: i + 2 })).filter(d => d.token);
}
function dropDevices_(rows) {
  const sh = sheet_('알림기기');
  rows.sort((a, b) => b - a).forEach(r => sh.deleteRow(r));
}

// 한 기기에 보내기: 'ok' | 'gone'(지워진 기기) | 'error:코드'
function sendOne_(token, msg, at, projectId) {
  const r = UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/' + projectId + '/messages:send', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + at },
    payload: JSON.stringify({ message: {
      token: token,
      data: { title: msg.title || '오병이어', body: msg.body, go: msg.go || 'home', tag: msg.tag || 'obye' },
      webpush: { headers: { Urgency: 'high', TTL: '7200' } }
    } })
  });
  const code = r.getResponseCode();
  if (code === 200) return 'ok';
  if (code === 404 || /UNREGISTERED/.test(r.getContentText())) return 'gone';
  return 'error:' + code;
}
function sendAll_(msg) {
  const web = JSON.parse(PropertiesService.getScriptProperties().getProperty('push_web') || 'null');
  if (!web) throw new Error('알림 준비가 안 됐어요');
  const at = fcmToken_();
  const devs = devices_().filter(d => d.role === 'owner');     // 보기 전용 기기에는 보내지 않음
  let sent = 0; const gone = [];
  devs.forEach(d => { const res = sendOne_(d.token, msg, at, web.projectId); if (res === 'ok') sent++; else if (res === 'gone') gone.push(d.row); });
  if (gone.length) dropDevices_(gone);
  return { sent: sent, total: devs.length };
}

// 앱에서 오는 알림 요청 (청지기만)
function pushAction_(body) {
  const web = JSON.parse(PropertiesService.getScriptProperties().getProperty('push_web') || 'null');
  if (!web) return { ok: false, error: 'push_not_ready' };
  if (body.action === 'pushInfo') return { ok: true, web: web };
  const tok = String(body.fcm || '');
  if (!/^[\w:.-]{20,400}$/.test(tok)) return { ok: false, error: 'bad_token' };
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return { ok: false, error: 'busy' };
  try {
    if (body.action === 'pushRegister') {
      const sh = ensureDeviceTab_();
      const old = String(body.old || '');
      if (old && old !== tok) dropDevices_(devices_().filter(d => d.token === old).map(d => d.row));
      if (!devices_().some(d => d.token === tok)) {
        sh.getRange(sh.getLastRow() + 1, 1, 1, 4).setNumberFormat('@')
          .setValues([[tok, 'owner', String(Date.now()), String(body.ua || '').slice(0, 120)]]);
      }
      return { ok: true };
    }
    if (body.action === 'pushUnregister') { dropDevices_(devices_().filter(d => d.token === tok).map(d => d.row)); return { ok: true }; }
    if (body.action === 'pushTest') {
      const res = sendOne_(tok, { body: '알림이 잘 와요! 정해 둔 시간에 이렇게 알려 드릴게요.', go: 'home', tag: 'test' }, fcmToken_(), web.projectId);
      return res === 'ok' ? { ok: true } : { ok: false, error: res };
    }
    return { ok: false, error: 'bad_action' };
  } finally { lock.releaseLock(); }
}

function settingsMap_() {
  const o = {};
  const sh = sheet_('설정'); if (!sh || sh.getLastRow() < 2) return o;
  sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().forEach(r => { try { o[String(r[0])] = JSON.parse(r[1]); } catch (e) { /* 건너뜀 */ } });
  return o;
}
function notiPrefs_(saved) {
  const n = JSON.parse(JSON.stringify(NOTI_DEFAULT));
  Object.keys(n).forEach(k => { if (saved && saved[k]) Object.assign(n[k], saved[k]); });
  return n;
}
function toMin_(hm) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(hm || '')); return m ? +m[1] * 60 + +m[2] : -1; }

// 3일 뒤가 카드 결제일이면 그 날짜(일), 아니면 0
function payDayIn3_(now, cards) {
  const d = new Date(now.getTime() + 3 * 86400000);
  const y = +Utilities.formatDate(d, TZ, 'yyyy'), m = +Utilities.formatDate(d, TZ, 'M'), day = +Utilities.formatDate(d, TZ, 'd');
  const last = new Date(y, m, 0).getDate();
  return (cards || []).some(c => Math.min(+c.payDay || 15, last) === day) ? day : 0;
}

// 시간 트리거 (15분마다)
function pushTick() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty('push_sa')) return;
  const now = new Date();
  const today = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const dow = +Utilities.formatDate(now, TZ, 'u');            // 1=월 … 7=일
  const mins = toMin_(Utilities.formatDate(now, TZ, 'HH:mm'));
  const S = settingsMap_();
  const N = notiPrefs_(S.noti);
  const due = [];
  const slot = (kind, time, msg) => { const t = toMin_(time); if (t >= 0 && mins >= t && mins < t + 50) due.push({ key: kind + '@' + time, kind: kind, msg: msg }); };
  if (N.evening.on && dow <= 5) slot('evening', N.evening.time, NOTI_TEXT.evening);
  if (N.weekend.on && dow >= 6) { slot('weekend', N.weekend.time, NOTI_TEXT.weekend); slot('weekend', N.weekend.time2, NOTI_TEXT.weekend); }
  if (N.sunday.on && dow === 7) slot('sunday', N.sunday.time, NOTI_TEXT.sunday);
  if (N.payday.on) {
    const d = payDayIn3_(now, S.cards);
    if (d) slot('payday', N.payday.time, { body: NOTI_TEXT.payday.body.replace('{d}', d), go: NOTI_TEXT.payday.go });
  }
  if (!due.length) return;
  let sent = JSON.parse(props.getProperty('push_sent') || 'null');
  if (!sent || sent.day !== today) sent = { day: today, keys: [] };
  due.forEach(x => {
    if (sent.keys.indexOf(x.key) >= 0) return;
    sent.keys.push(x.key);
    props.setProperty('push_sent', JSON.stringify(sent));     // 먼저 적어 두어 두 번 가지 않게
    try { sendAll_({ body: x.msg.body, go: x.msg.go, tag: x.kind }); }
    catch (e) { console.log('알림 실패 ' + x.kind + ': ' + e.message); }
  });
}
