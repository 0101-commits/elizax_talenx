/* tx_fix_work.js — 2026-07-15 fidelity 고도화 pass for the 업무관리(Work) menu.
   Runtime DOM patch only. Does NOT edit index.html. Idempotent, IIFE, zero deps
   beyond window.TXFIX (helpers) and window.TX (interaction kit). No network.

   Fixes (from real-talenx diff):
   1  업무보드 default tab → 전체 업무보드 (no blank first paint)
   2  replace 5 test/dummy cards with 13 realistic board cards + real member avatars
   3  favorites: ★ mark 3 boards, populate 즐겨찾기 panel, ★ toggle on every card
   4  empty-state CTA for 즐겨찾기 when truly empty
   5  wire header ⋮ and per-card ⋮ (TX.menu)
   6  gray-silhouette avatars → TXFIX.avatar initials, member stacks
   7  스크럼보드: render the 4 standard scrum questions w/ colored left bars
   8  rename 스크럼보드A → 주간업무보고, drop the "ㅁㄴㅇ" placeholder tab
   9  scrum author → 이름(소속팀) via nameTeam, realistic answers, recent 2026-06 date
   10 board card body click → 보드 상세 drawer (진행 요약·업무 목록·멤버·스크럼보드 이동)
*/
(function () {
  'use strict';

  var F = window.TXFIX || null;
  var TX = window.TX || { toast: function () {}, menu: function () {}, modal: function () {}, confirm: function () {} };
  if (!F || !F.ready) return; // common helpers must be present

  var esc = (TX.esc) || function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  };

  /* ---------- board model (favorite state is module-scoped → survives re-render) ---------- */
  // member ids reference real employees in window.TALENX_DATA; avatars derive from their names.
  var BOARDS = [
    { id: 'wb-01', name: 'A 프로젝트',                locked: false, fav: false, members: ['EMP-0015', 'EMP-0008'] },
    { id: 'wb-02', name: '기존고객 관리',              locked: false, fav: false, members: ['EMP-0022', 'EMP-0002', 'EMP-0025'] },
    { id: 'wb-03', name: '글로벌부문',                locked: false, fav: false, members: ['EMP-0021', 'EMP-0020'] },
    { id: 'wb-04', name: '인사제도 혁신 프로젝트 TF',   locked: true,  fav: false, members: ['EMP-0078', 'EMP-0006', 'EMP-0029'] },
    { id: 'wb-05', name: '신규 수주 영업',             locked: false, fav: true,  members: ['EMP-0002', 'EMP-0024'] },
    { id: 'wb-06', name: '채용 대시보드',              locked: true,  fav: true,  members: ['EMP-0032'] },
    { id: 'wb-07', name: '후임자 관리',               locked: true,  fav: false, members: ['EMP-0006', 'EMP-0028'] },
    { id: 'wb-08', name: '인사실 공식 게시판',          locked: true,  fav: true,  members: ['EMP-0078'] },
    { id: 'wb-09', name: '주간업무보고',              locked: false, fav: false, members: ['EMP-0003', 'EMP-0034'] },
    { id: 'wb-10', name: '제품기획 로드맵',            locked: false, fav: false, members: ['EMP-0012', 'EMP-0023', 'EMP-0038', 'EMP-0040'] },
    { id: 'wb-11', name: '품질개선 TF',               locked: false, fav: false, members: ['EMP-0033', 'EMP-0037'] },
    { id: 'wb-12', name: 'CS 대응',                  locked: false, fav: false, members: ['EMP-0022', 'EMP-0030'] },
    { id: 'wb-13', name: '마케팅 캠페인',              locked: false, fav: false, members: ['EMP-0002', 'EMP-0011', 'EMP-0019'] }
  ];
  function boardById(id) { for (var i = 0; i < BOARDS.length; i++) if (BOARDS[i].id === id) return BOARDS[i]; return null; }

  // locked 보드 접근 게이트: 멤버면 허용, 아니면 hr/exec만 허용(member/leader 차단)
  function canOpen(b) {
    if (!b.locked) return true;
    var ROLE = (F.CU && F.CU._role) || (window.TXRoles && TXRoles.current && TXRoles.current().key) || 'member';
    var myId = F.CU && F.CU.emp_id;
    if (myId && b.members.indexOf(myId) !== -1) return true; // 실제 멤버십
    return ROLE === 'hr' || ROLE === 'exec';                 // 롤 기반 폴백
  }

  var LOCK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--ink-3);flex:none"><rect x="4" y="10.5" width="16" height="10.5" rx="2"/><path d="M8 10.5V7a4 4 0 018 0v3.5"/></svg>';

  /* ---------- renderers ---------- */
  function avatarStack(memberIds) {
    var html = '<div class="txf-stack" style="display:flex;align-items:center;margin-top:20px">';
    var show = memberIds.slice(0, 4);
    show.forEach(function (id) {
      var e = F.emp(id);
      html += F.avatar(e ? e.name : '?', 30);
    });
    if (memberIds.length > 4) {
      html += '<span class="txf-more">+' + (memberIds.length - 4) + '</span>';
    }
    return html + '</div>';
  }

  function boardCard(b) {
    var star = '<span class="txf-star" data-bid="' + b.id + '" role="button" tabindex="0" aria-label="즐겨찾기"'
      + ' style="cursor:pointer;font-size:15px;line-height:1;color:' + (b.fav ? 'var(--gold)' : 'var(--ink-4)') + '">'
      + (b.fav ? '★' : '☆') + '</span>';
    var lock = b.locked ? LOCK_SVG : '';
    return ''
      + '<div class="card txf-board" data-bid="' + b.id + '" style="padding:18px 20px;min-height:120px">'
      + '  <div style="display:flex;align-items:flex-start">'
      + '    <div class="txf-btitle" style="display:flex;align-items:center;gap:6px;font-size:15px;font-weight:700;color:var(--ink);min-width:0">'
      + star + lock + '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(b.name) + '</span>'
      + '    </div>'
      + '    <span class="spacer" style="flex:1"></span>'
      + '    <span class="wp-kebab txf-cardkebab" role="button" tabindex="0" aria-label="더보기">⋮</span>'
      + '  </div>'
      + avatarStack(b.members)
      + '</div>';
  }

  function grid(list) {
    return '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">'
      + list.map(boardCard).join('') + '</div>';
  }

  function favEmptyState() {
    return ''
      + '<div class="card txf-empty" style="display:grid;place-items:center;min-height:200px;text-align:center">'
      + '  <div>'
      + '    <div class="empty" style="margin-bottom:14px">즐겨찾기한 업무보드가 없습니다.</div>'
      + '    <div style="display:flex;gap:8px;justify-content:center">'
      + '      <button class="txf-goall" style="background:var(--card);border:1px solid var(--line);color:var(--ink);font-size:13px;font-weight:700;padding:9px 16px;border-radius:8px;cursor:pointer">전체 업무보드 보기</button>'
      + '      <button class="txf-addboard" style="background:var(--blue);color:#fff;font-size:13px;font-weight:700;padding:9px 16px;border-radius:8px;cursor:pointer">업무보드 추가</button>'
      + '    </div>'
      + '  </div>'
      + '</div>';
  }

  /* ---------- 10: board detail drawer (deterministic mock — no Math.random) ---------- */
  function hashBid(s) {
    var h = 0;
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return h;
  }

  var DESC_POOL = [
    '팀 업무 진행 상황과 일정을 한곳에서 관리하는 보드입니다.',
    '협업 과제와 담당자별 진행 현황을 추적하는 보드입니다.',
    '주요 안건과 마감 일정을 공유하는 협업 보드입니다.',
    '이슈 대응과 후속 조치를 기록·관리하는 보드입니다.'
  ];
  var TASK_POOL = [
    '요구사항 정의서 검토', '주간 진행현황 정리', '고객 미팅 후속 조치', '리스크 항목 점검',
    'UI 시안 피드백 반영', '테스트 시나리오 작성', '결과 보고서 초안 작성', '일정 재조정 협의',
    '데이터 정확성 확인', '운영 이관 체크리스트 점검'
  ];
  var TASK_ST = [
    { label: '할 일',   fg: 'var(--ink-2)', bg: 'rgba(16,24,40,.06)' },
    { label: '진행 중', fg: 'var(--blue)',  bg: 'rgba(31,122,240,.10)' },
    { label: '완료',    fg: 'var(--green)', bg: 'rgba(22,163,74,.10)' }
  ];

  function boardTasks(b) {
    var h = hashBid(b.id);
    var n = 5 + (h % 3); // 5~7건
    var emps = (F.D && F.D.employees) || [];
    var tasks = [];
    for (var i = 0; i < n; i++) {
      var owner = b.members.length ? F.emp(b.members[(h + i) % b.members.length]) : null;
      if (!owner && emps.length) owner = emps[(h + i * 13) % emps.length];
      tasks.push({
        name: TASK_POOL[(h + i * 3) % TASK_POOL.length],
        st: TASK_ST[(h + i * 5) % 3],
        owner: owner,
        due: '2026-07-' + ('0' + (10 + (((h >> 3) + i * 7) % 21))).slice(-2)
      });
    }
    return tasks;
  }

  function taskRow(t) {
    var who = t.owner
      ? '<span style="display:inline-flex;align-items:center;gap:6px;flex:none">' + F.avatar(t.owner.name, 22)
        + '<span style="font-size:12px;color:var(--ink-2)">' + esc(t.owner.name) + '</span></span>'
      : '<span style="font-size:12px;color:var(--ink-4)">미지정</span>';
    return ''
      + '<div style="display:flex;align-items:center;gap:10px;padding:10px 2px;border-bottom:1px solid var(--line)">'
      + '  <span style="flex:none;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;background:' + t.st.bg + ';color:' + t.st.fg + '">' + t.st.label + '</span>'
      + '  <span style="flex:1;min-width:0;font-size:13px;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(t.name) + '</span>'
      +    who
      + '  <span style="flex:none;font-size:12px;color:var(--ink-3)">' + t.due + '</span>'
      + '</div>';
  }

  function openBoardDetail(bid) {
    var b = boardById(bid); if (!b) return;
    if (!canOpen(b)) { TX.toast('접근 권한이 없는 보드입니다.'); return; }
    if (!TX.drawer) { TX.toast('보드 상세를 불러왔습니다.'); return; }
    var h = hashBid(bid);
    var tasks = boardTasks(b);
    var cnt = { '할 일': 0, '진행 중': 0, '완료': 0 };
    tasks.forEach(function (t) { cnt[t.st.label]++; });

    var stat = function (label, n, color) {
      return '<div style="flex:1;background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px 0;text-align:center">'
        + '<div style="font-size:20px;font-weight:800;color:' + color + '">' + n + '</div>'
        + '<div style="font-size:12px;color:var(--ink-3);margin-top:2px">' + label + '</div></div>';
    };

    var memberAvas = b.members.map(function (id) {
      var e = F.emp(id);
      return e ? F.avatar(e.name, 30) : '';
    }).join('');
    var memberNames = b.members.map(function (id) {
      var e = F.emp(id);
      return e ? e.name : '';
    }).filter(Boolean).join(', ');

    var html = ''
      + '<div style="padding:2px 2px 8px">'
      + '  <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">'
      +     (b.locked ? LOCK_SVG : '')
      + '    <span style="font-size:16px;font-weight:800;color:var(--ink)">' + esc(b.name) + '</span>'
      + '  </div>'
      + '  <div style="font-size:13px;color:var(--ink-2);margin-bottom:16px">' + DESC_POOL[h % DESC_POOL.length] + '</div>'

      + '  <div style="font-size:12px;font-weight:700;color:var(--ink-3);margin-bottom:8px">진행 상태 요약</div>'
      + '  <div style="display:flex;gap:10px;margin-bottom:18px">'
      +      stat('할 일', cnt['할 일'], 'var(--ink-2)')
      +      stat('진행 중', cnt['진행 중'], 'var(--blue)')
      +      stat('완료', cnt['완료'], 'var(--green)')
      + '  </div>'

      + '  <div style="font-size:12px;font-weight:700;color:var(--ink-3);margin-bottom:2px">업무 목록 · ' + tasks.length + '건</div>'
      +    tasks.map(taskRow).join('')

      + '  <div style="font-size:12px;font-weight:700;color:var(--ink-3);margin:16px 0 8px">멤버 · ' + b.members.length + '명</div>'
      + '  <div class="txf-stack" style="display:flex;align-items:center">' + memberAvas
      + '    <span style="font-size:12px;color:var(--ink-2);margin-left:10px">' + esc(memberNames) + '</span>'
      + '  </div>'

      + '  <div style="margin-top:20px;padding-top:14px;border-top:1px solid var(--line)">'
      + '    <button class="txf-bd-scrum" style="width:100%;background:var(--blue);color:#fff;font-size:13px;font-weight:700;padding:10px 0;border-radius:8px;cursor:pointer;border:none">스크럼보드 열기</button>'
      + '  </div>'
      + '</div>';

    var dr = TX.drawer({ title: esc(b.name), subtitle: '업무보드 상세', body: html, width: '560px' });
    var btn = dr && dr.body && dr.body.querySelector('.txf-bd-scrum');
    if (btn) btn.addEventListener('click', function () {
      var link = document.querySelector('#s-work .subnav a[data-p="1"]');
      if (link) { dr.close(); link.click(); TX.toast('스크럼보드로 이동했습니다.'); }
      else TX.toast('스크럼보드 화면을 준비 중입니다.');
    });
  }

  function paintBoards(sec) {
    var favPanel = sec.querySelector('[data-wpanel="0"]');
    var allPanel = sec.querySelector('[data-wpanel="1"]');
    if (!favPanel || !allPanel) return;
    allPanel.innerHTML = grid(BOARDS);
    var favs = BOARDS.filter(function (b) { return b.fav; });
    favPanel.innerHTML = favs.length ? grid(favs) : favEmptyState();
  }

  /* ---------- scrum board ---------- */
  var SCRUM_Q = [
    { q: '어제 무엇을 하셨나요?',                  bar: 'var(--blue)',  a: 'Package BG 주간 리포트 초안 정리, 파트너사 도입 미팅 2건 진행했습니다.' },
    { q: '오늘 무엇을 하실 예정인가요?',            bar: 'var(--red)',   a: '신규 제품 패키지 가격안 검토, QA 이슈 회신 및 배포 일정 확정.' },
    { q: '업무 진행에 장애물이 있나요?',            bar: 'var(--gold)',  a: '디자인 리소스 일정 조율 필요 — UX Center 협업 응답 대기 중입니다.' },
    { q: '그 외 자유롭게 공유하고 싶은 내용이 있나요?', bar: 'var(--green)', a: '다음 주 월요일 팀 워크숍 일정 공유드립니다. 참석 여부 회신 부탁드립니다.' }
  ];

  function scrumPost() {
    var author = F.nameTeam(F.CU && F.CU.emp_id ? F.CU.emp_id : 'EMP-0078') || '최정남(Package BG)';
    var name = (F.CU && F.CU.name) || '최정남';
    var qs = SCRUM_Q.map(function (item) {
      return ''
        + '<div class="p-q">' + esc(item.q) + '</div>'
        + '<div class="p-quote" style="border-left-color:' + item.bar + ';color:var(--ink-2);letter-spacing:normal;margin-bottom:16px">'
        + esc(item.a) + '</div>';
    }).join('');
    return ''
      + '<div class="card sc-post">'
      + '  <div class="p-top">'
      +      F.avatar(name, 32)
      + '    <span class="p-name">' + esc(author) + '</span>'
      + '    <span class="spacer" style="flex:1"></span>'
      + '    <span class="p-icon" style="margin-right:14px"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg></span>'
      + '    <span class="wp-kebab txf-postkebab" role="button" tabindex="0" aria-label="더보기" style="font-size:16px">⋮</span>'
      + '  </div>'
      +    qs
      + '  <div class="p-foot">'
      + '    <span class="fitem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg> 좋아요 3</span>'
      + '    <span class="fitem"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 11.5a8.4 8.4 0 01-9 8.4 9 9 0 01-4-.9L3 21l1.9-4.9A8.4 8.4 0 1121 11.5z"/></svg> 댓글 2</span>'
      + '    <span class="fdate">6월 16일 화요일 오전 10:06</span>'
      + '  </div>'
      + '</div>';
  }

  function paintScrum(sec) {
    var sp = sec.querySelector('.subpage[data-p="1"]');
    if (!sp) return;
    // 8: rebuild tabs row → single 주간업무보고 tab (drop "ㅁㄴㅇ")
    var tabs = sp.querySelector('.sc-tabs');
    if (tabs && !tabs.dataset.txf) {
      tabs.dataset.txf = '1';
      tabs.innerHTML = ''
        + '<span class="sc-tab on">주간업무보고</span>'
        + '<span class="sc-add">+&nbsp;스크럼보드 추가</span>'
        + '<span class="spacer" style="flex:1"></span>'
        + '<span class="wp-kebab txf-sckebab" role="button" tabindex="0" aria-label="더보기" style="font-size:18px">⋮</span>';
    }
    // header h3 rename
    var h = sp.querySelector('.sc-head h3');
    if (h) h.textContent = '주간업무보고';
    // date chip → recent 2026-06
    var dateSpan = sp.querySelector('.sc-date span');
    if (dateSpan) {
      dateSpan.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--ink-2)"><rect x="3" y="4.5" width="18" height="16" rx="2"/><path d="M3 9h18M8 3v3M16 3v3"/></svg> 2026-06-16';
    }
    // 7+9: replace the single-question post with the 4-question standard post
    var oldPost = sp.querySelector('.sc-post');
    if (oldPost) {
      var tmp = document.createElement('div');
      tmp.innerHTML = scrumPost();
      oldPost.parentNode.replaceChild(tmp.firstElementChild, oldPost);
    }
  }

  /* ---------- interaction wiring (delegated, guarded) ---------- */
  function toggleFav(bid) {
    var b = boardById(bid);
    if (!b) return;
    b.fav = !b.fav;
    var sec = document.getElementById('s-work');
    if (sec) paintBoards(sec);
    TX.toast(b.fav ? ('‘' + b.name + '’ 즐겨찾기에 추가했습니다.') : ('‘' + b.name + '’ 즐겨찾기에서 제거했습니다.'), b.fav ? 'ok' : null);
  }

  function cardMenu(anchor, bid) {
    var b = boardById(bid); if (!b) return;
    TX.menu(anchor, [
      { label: '보드 열기', onClick: function () { openBoardDetail(bid); } },
      { label: '이름 변경', onClick: function () { TX.toast('보드 이름을 변경합니다.'); } },
      { label: b.fav ? '즐겨찾기 해제' : '즐겨찾기', onClick: function () { toggleFav(bid); } },
      { label: '멤버 관리', onClick: function () { TX.toast('멤버 관리 화면으로 이동합니다.'); } },
      { sep: true },
      { label: '보드 삭제', danger: true, onClick: function () { TX.confirm('업무보드 삭제', '‘' + b.name + '’ 보드를 삭제하시겠습니까?', function () { TX.toast('보드를 삭제했습니다.'); }, '삭제'); } }
    ]);
  }

  function headerMenu(anchor) {
    TX.menu(anchor, [
      { label: '업무보드 추가', onClick: function () { TX.toast('새 업무보드를 추가합니다.'); } },
      { label: '보드 순서 편집', onClick: function () { TX.toast('보드 순서 편집 모드입니다.'); } },
      { label: '보관된 보드', onClick: function () { TX.toast('보관된 보드를 확인합니다.'); } }
    ]);
  }

  function scrumTabsMenu(anchor) {
    TX.menu(anchor, [
      { label: '스크럼보드 이름 변경', onClick: function () { TX.toast('스크럼보드 이름을 변경합니다.'); } },
      { label: '스크럼보드 설정', onClick: function () { TX.toast('스크럼보드 설정을 엽니다.'); } },
      { label: '스크럼보드 보관', onClick: function () { TX.toast('스크럼보드를 보관했습니다.'); } }
    ]);
  }

  function postMenu(anchor) {
    TX.menu(anchor, [
      { label: '수정', onClick: function () { TX.toast('스크럼을 수정합니다.'); } },
      { label: '댓글 보기', onClick: function () { TX.toast('댓글을 확인합니다.'); } },
      { label: '링크 복사', onClick: function () { TX.toast('링크를 복사했습니다.', 'ok'); } },
      { sep: true },
      { label: '삭제', danger: true, onClick: function () { TX.confirm('스크럼 삭제', '이 스크럼을 삭제하시겠습니까?', function () { TX.toast('삭제되었습니다.'); }, '삭제'); } }
    ]);
  }

  function selectTab(sec, idx) {
    var tabs = sec.querySelectorAll('.subpage[data-p="0"] .segtabs button');
    var panels = sec.querySelectorAll('[data-wpanel]');
    tabs.forEach(function (b, i) { b.classList.toggle('on', i === idx); });
    panels.forEach(function (p) { p.style.display = (+p.dataset.wpanel === idx) ? '' : 'none'; });
  }

  /* ---------- init ---------- */
  function render() {
    var sec = document.getElementById('s-work');
    if (!sec) return;
    paintBoards(sec);
    paintScrum(sec);
    if (!sec.dataset.txfDefault) {
      sec.dataset.txfDefault = '1';
      selectTab(sec, 1); // fix 1: default → 전체 업무보드
    }
  }

  function init() {
    var sec = document.getElementById('s-work');
    if (!sec || sec.dataset.txfWork === '1') { if (sec) render(); return; }
    sec.dataset.txfWork = '1';

    // one delegated listener on the section. Runs on bubble BEFORE the global
    // tx_revive document handler, so stopPropagation() keeps our specific menus.
    sec.addEventListener('click', function (ev) {
      var t = ev.target;
      var star = t.closest && t.closest('.txf-star');
      if (star) { ev.preventDefault(); ev.stopPropagation(); toggleFav(star.getAttribute('data-bid')); return; }

      if (t.closest && (t.closest('.txf-goall'))) {
        ev.preventDefault(); ev.stopPropagation(); selectTab(sec, 1); return;
      }
      if (t.closest && (t.closest('.txf-addboard'))) {
        ev.preventDefault(); ev.stopPropagation(); TX.toast('새 업무보드를 추가합니다.'); return;
      }

      var keb = t.closest && t.closest('.wp-kebab');
      if (keb) {
        ev.preventDefault(); ev.stopPropagation();
        var boardEl = keb.closest('.txf-board');
        if (boardEl) { cardMenu(keb, boardEl.getAttribute('data-bid')); return; }
        if (keb.closest('.sc-post')) { postMenu(keb); return; }
        if (keb.closest('.sc-tabs')) { scrumTabsMenu(keb); return; }
        headerMenu(keb); // header card ⋮ (업무보드)
        return;
      }

      // 10: card body → board detail drawer (star/kebab/buttons already returned above)
      var card = t.closest && t.closest('.txf-board');
      if (card && !(t.closest('button'))) {
        ev.preventDefault(); ev.stopPropagation();
        openBoardDetail(card.getAttribute('data-bid'));
        return;
      }
    }, false);

    // re-apply after subnav (업무보드/스크럼보드) switches — DOM persists but this is idempotent
    var links = sec.querySelectorAll('.subnav a[data-p]');
    links.forEach(function (a) { a.addEventListener('click', function () { setTimeout(render, 0); }); });

    render();
  }

  // small style layer (prefixed) for member stacks + empty state
  (function injectStyle() {
    if (document.getElementById('txf-work-style')) return;
    var s = document.createElement('style');
    s.id = 'txf-work-style';
    s.textContent = ''
      + '#s-work .txf-stack .txf-ava{box-shadow:0 0 0 2px var(--card)}'
      + '#s-work .txf-stack .txf-ava + .txf-ava{margin-left:-10px}'
      + '#s-work .txf-stack .txf-more{display:inline-flex;align-items:center;margin-left:6px;font-size:12px;font-weight:700;color:var(--ink-3)}'
      + '#s-work .txf-board{transition:box-shadow .15s ease;cursor:pointer}'
      + '#s-work .txf-board:hover{box-shadow:0 2px 10px rgba(16,24,40,.08)}'
      + '#s-work .txf-star:hover{color:var(--gold)!important}'
      + '#s-work .txf-cardkebab,#s-work .txf-sckebab,#s-work .txf-postkebab{cursor:pointer}';
    document.head.appendChild(s);
  })();

  F.ready(init);
  if (F.onSection) F.onSection('s-work', render);
})();
