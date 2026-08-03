const fs = require('fs');

// talenx_data.js 파일 읽기 및 JSON 추출
const content = fs.readFileSync('./js/talenx_data.js', 'utf8');
const match = content.match(/window\.TALENX_DATA\s*=\s*([\s\S]+?);\s*$/m);

if (!match) {
  console.error('데이터 파싱 실패');
  process.exit(1);
}

let data;
try {
  data = JSON.parse(match[1]);
} catch (e) {
  console.error('JSON 파싱 실패:', e.message);
  process.exit(1);
}

const ROLE_EMP = { member: 'EMP-0078', leader: 'EMP-0030', hr: 'EMP-0005', exec: 'EMP-0001' };
const asof = '2026-07-16';
const asofMs = Date.parse(asof + 'T00:00:00Z');

function gapDays(dateStr) {
  const t = Date.parse(String(dateStr).slice(0, 10) + 'T00:00:00Z');
  return isNaN(t) ? null : Math.floor((asofMs - t) / 86400000);
}

// === 목표수립 신호 ===
const memberObjs = data.objectives.filter(o => o.owner_emp_id === ROLE_EMP.member);
const leaderObjs = data.objectives.filter(o => o.owner_emp_id === ROLE_EMP.leader);
const goalPer = data.periods.find(p => p.kind === 'goal' && p.status !== 'closed');

console.log('목표수립-구성원-01 · member');
console.log('  hit 조건: days_left <= 3 && owner_emp_id의 objectives.length <= 0');
console.log('  지금 거짓인 이유: objectives(' + memberObjs.length + '건) > 0');
if (goalPer) {
  console.log('  days_left=' + goalPer.days_left + ' (기준: <= 3)');
}
console.log('  심어야 할 것: member의 목표를 모두 삭제하거나 0건 상태로 만들기');
console.log('');

// 목표수립-구성원-02
console.log('목표수립-구성원-02 · member');
if (memberObjs.length > 0) {
  const obj = memberObjs[0];
  const krs = data.keyResults.filter(k => k.objective_id === obj.objective_id);
  const elapsed = gapDays(obj.created_at);
  console.log('  hit 조건: keyResults.length <= 0 && elapsed >= 7');
  console.log('  지금 거짓인 이유: keyResults(' + krs.length + '건) > 0');
  console.log('  심어야 할 것: 첫 목표의 KR을 모두 삭제');
} else {
  console.log('  지금 거짓인 이유: 구성원이 저장한 목표가 없음');
}
console.log('');

// 목표수립-구성원-06
console.log('목표수립-구성원-06 · member');
const noParent = memberObjs.filter(o => !o.parent_objective_id);
console.log('  hit 조건: days_left <= 3 && parent_objective_id없는 목표 >= 1');
console.log('  지금 거짓인 이유: parent_objective_id 미연결(' + noParent.length + '건) < 1');
console.log('  심어야 할 것: member 목표 중 하나의 parent_objective_id를 null로 설정');
console.log('');

// === 중간점검 신호 ===
const memberCks = data.checkins.filter(c => c.emp_id === ROLE_EMP.member)
  .sort((a, b) => a.checkin_date < b.checkin_date ? -1 : 1);
const checkPer = data.periods.find(p => p.kind === 'checkin' && p.status !== 'closed');

console.log('중간점검-구성원-01 · member');
if (memberCks.length > 0) {
  const last = memberCks[memberCks.length - 1];
  const gap = gapDays(last.checkin_date);
  console.log('  hit 조건: gap >= 14');
  console.log('  지금 거짓인 이유: gap=' + gap + ' (< 14)');
  console.log('  심어야 할 것: 마지막 checkin_date를 더 오래된 날짜로 변경 (14일 이상 전)');
} else {
  console.log('  지금 거짓인 이유: 체크인 데이터 없음');
}
console.log('');

console.log('중간점검-구성원-06 · member');
if (checkPer) {
  const thisMonth = memberCks.filter(c => c.checkin_date.slice(0, 7) === asof.slice(0, 7));
  console.log('  hit 조건: days_left <= 2 && 당월 체크인 == 0');
  console.log('  지금 거짓인 이유: thisMonth(' + thisMonth.length + '건) > 0 또는 days_left > 2');
  console.log('  심어야 할 것: 현월(2026-07) 체크인을 모두 삭제 또는 이전 월짜로 변경');
} else {
  console.log('  지금 거짓인 이유: 활성 체크인 기간 없음');
}
console.log('');

// 팀장 신호 - 팀원 데이터
const reports = data.employees.filter(e => e.manager_id === ROLE_EMP.leader);
console.log('중간점검-팀장-01 · leader');
console.log('  팀 규모:', reports.length + '명');
const reportZeros = reports.filter(e => {
  const ck = data.checkins.filter(c => c.emp_id === e.emp_id && c.checkin_date >= (checkPer ? checkPer.start : '2026-07-01'));
  return ck.length === 0;
});
console.log('  hit 조건: days_left <= 5 && 팀원 중 이번회차 체크인 == 0인 사람 >= 1');
console.log('  지금 거짓인 이유: 미제출 팀원(' + reportZeros.length + '명) < 1 또는 days_left > 5');
console.log('  심어야 할 것: 팀원 한 명의 이번회차 체크인을 모두 삭제 또는 이전 기간으로 변경');
console.log('');

console.log('=== eval2/eval3에 없는 신호 ===');
console.log('목표수립-구성원-08, 10');
console.log('목표수립-상위조직장-05, 08');
console.log('중간점검-구성원-08');
console.log('중간점검-상위조직장-03, 05');
