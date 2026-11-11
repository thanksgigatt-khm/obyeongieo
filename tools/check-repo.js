#!/usr/bin/env node
// 저장소 개인정보 검사 (명세서 0-1, 9장). 배포 전에 GitHub Actions에서도 실행한다.
// 사용: node tools/check-repo.js [저장소 폴더]
// 올라가 있거나 올라갈 파일(커밋된 것 + .gitignore에 안 걸린 새 파일) 가운데
// 명세서·데이터 파일, 옮기기용 파일, 비밀 키가 있으면 실패(종료 코드 1)한다.
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = path.resolve(process.argv[2] || '.');
const KEY_WORD = 'private' + '_key';   // 이 파일 자체가 걸리지 않게 나눠 씀

let files;
try {
  const out = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: dir, encoding: 'utf8' });
  files = [...new Set(out.split('\0').filter(Boolean))];
} catch (e) {
  console.error('검사 실패: git 저장소가 아니거나 git을 실행할 수 없어요.');
  process.exit(2);
}

const problems = [];
const JSON_OK = new Set(['package.json', 'package-lock.json']);
for (const f of files) {
  const base = path.basename(f).toLowerCase();
  const ext = path.extname(base);
  if (['.xls', '.xlsx', '.pdf', '.csv'].includes(ext)) problems.push(`${f}: 명세서·데이터 파일(${ext})은 올리면 안 돼요`);
  else if (ext === '.json' && !JSON_OK.has(base) && !base.endsWith('.example.json')) problems.push(`${f}: 데이터 json은 올리면 안 돼요`);
  if (/gagyebu-export|옮기기용/.test(base)) problems.push(`${f}: 가계부 옮기기용 파일이에요`);
  if (/^service-account|^\.env(\.|$)|\.pem$|\.key$/.test(base)) problems.push(`${f}: 비밀값 파일이에요`);
  if (/^data\//.test(f.replace(/\\/g, '/'))) problems.push(`${f}: data/ 폴더는 올리면 안 돼요`);
  if (['.js', '.mjs', '.cjs', '.html', '.gs', '.css', '.webmanifest', '.yml', '.yaml', '.txt'].includes(ext)) {
    const full = path.join(dir, f);
    if (fs.existsSync(full) && fs.readFileSync(full, 'utf8').includes(KEY_WORD)) problems.push(`${f}: 서비스 계정 키(${KEY_WORD})가 들어 있어요`);
  }
}

if (problems.length) {
  console.error('개인정보 검사 실패:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`개인정보 검사 통과 (${files.length}개 파일)`);
