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
