/* ===== talenx mockup — tx_revive.js =====
   Revives dead/inert controls in the static talenx clone (index.html).
   Single IIFE, namespaced. Uses ONE delegated click listener on document so it
   survives DOM re-renders by the per-screen IIFEs. Adds behavior ONLY to controls
   that currently do nothing; never touches the existing working handlers
   (GNB routing, subnav data-p/data-nav, .subpage/.wf-page/.sp-page switching,
   msf .subtabs/.sortset, appr .ap-tabs/.ts-ftabs, hrm .htab/.depth-seg/.seg2,
   work .segtabs wpanel toggles, perf .pilltabs/.segtabs/.orgtabs visual toggles,
   home/gnb logo).
   Relies on globals: window.TX (overlay kit) and window.TALENX_DATA. */
(function(){
  'use strict';
  var TX = window.TX;
  if(!TX){ /* kit not present — nothing we can do */ return; }
  var D = window.TALENX_DATA || {};
  var esc = TX.esc || function(s){ return String(s==null?'':s); };

  /* ---------- tiny helpers ---------- */
  function txt(el){ return el ? (el.textContent||'').replace(/\s+/g,' ').trim() : ''; }
  function screenOf(el){ var s = el && el.closest && el.closest('.screen'); return s ? s.id : ''; }
  function stop(e){ e.preventDefault(); e.stopPropagation(); }
  function hash(s){ s=String(s||''); var h=0,i; for(i=0;i<s.length;i++){ h=((h<<5)-h+s.charCodeAt(i))|0; } return Math.abs(h); }
  function pick(arr, seed){ if(!arr||!arr.length) return null; return arr[hash(seed)%arr.length]; }
  function rowsHtml(pairs){
    return pairs.map(function(p){
      if(p[1]==null||p[1]==='') return '';
      return '<div class="tx-drow"><span class="k">'+esc(p[0])+'</span><span class="v">'+esc(p[1])+'</span></div>';
    }).join('');
  }
  function toggleGroupOn(btn, groupSel){
    var grp = btn.closest(groupSel);
    if(!grp) return;
    grp.querySelectorAll('button').forEach(function(b){ b.classList.toggle('on', b===btn); });
  }

  /* ---------- data lookups ---------- */
  function empByName(n){ return (D.employees||[]).find(function(e){ return e.name===n; }); }
  function evalForSeed(seed){ return pick(D.evaluations||[], seed); }
  function evalByEmp(id){ return (D.evaluations||[]).find(function(e){ return e.emp_id===id; }); }
  function historyByEmp(id){ var h=(D.evalHistory||[]).find(function(x){ return x.emp_id===id; }); return h?h.history:[]; }
  function objectivesForSeed(seed){
    var objs = D.objectives||[];
    if(!objs.length) return [];
    var start = hash(seed)%objs.length, out=[], i;
    for(i=0;i<3&&i<objs.length;i++){ out.push(objs[(start+i)%objs.length]); }
    return out;
  }
  function krsFor(objId){ return (D.keyResults||[]).filter(function(k){ return k.objective_id===objId; }); }

  /* ---------- employee detail drawer (인사관리 .mlink) ---------- */
  function openEmployeeDrawer(row){
    var name = txt(row.querySelector('.mlink')) || '구성원';
    var tds = row.querySelectorAll('td');
    var org='', empno='', duty='', rank='', pos='';
    if(tds.length>=7){
      org = txt(tds[2]).replace(/조직장$/,'').replace(/✓/,'').trim();
      empno = txt(tds[3]); duty = txt(tds[4]); rank = txt(tds[5]); pos = txt(tds[6]);
    }
    var emp = empByName(name);
    var ev  = emp ? (evalByEmp(emp.emp_id)||evalForSeed(name)) : evalForSeed(name);
    var seedId = emp ? emp.emp_id : (ev? ev.emp_id : name);
    var hist = historyByEmp(seedId);
    var objs = objectivesForSeed(seedId);

    var basic = rowsHtml([
      ['직무', emp? emp.jobTitle : (duty||'-')],
      ['소속', emp? emp.orgName : (org||'-')],
      ['레벨', emp? (emp.level_kr+' / '+emp.level) : (rank||'-')],
      ['직위', pos||'-'],
      ['사번', empno||(emp?emp.emp_id:'-')],
      ['입사일', emp? emp.join_date : '-'],
      ['근속', emp? (emp.tenure_years+'년') : '-'],
      ['매니저', emp? (emp.managerName||'-') : '-']
    ]);

    var evalHtml='';
    if(ev){
      evalHtml = '<h4>현재 평가</h4>'+
        '<div class="tx-kpi">'+
          '<div class="c"><div class="n">'+esc(ev.grade)+'</div><div class="l">등급</div></div>'+
          '<div class="c"><div class="n">'+esc(ev.weighted_score)+'</div><div class="l">종합 점수</div></div>'+
          '<div class="c"><div class="n">'+esc(ev.reward_coefficient)+'</div><div class="l">보상 계수</div></div>'+
        '</div>'+
        '<div style="font-size:13px;color:var(--ink-2);line-height:1.6;margin-top:6px">'+esc(ev.rationale_summary)+'</div>';
    }

    var histHtml='';
    if(hist && hist.length){
      histHtml = '<h4>평가 추이</h4>'+ rowsHtml(hist.map(function(h){ return [h.period, h.grade+' · '+h.score+'점']; }));
    }

    var objHtml='';
    if(objs.length){
      objHtml = '<h4>주요 목표</h4>' + objs.map(function(o){
        var krs = krsFor(o.objective_id).slice(0,2);
        var krLines = krs.map(function(k){
          return '<div class="tx-drow"><span class="k">'+esc(k.name)+'</span><span class="v">'+esc(k.progress)+'%</span></div>';
        }).join('');
        return '<div style="margin:10px 0 4px;font-weight:700;font-size:13.5px;color:var(--ink)">'+esc(o.title)+
               ' <span style="color:var(--ink-3);font-weight:600">('+esc(o.status)+' · '+esc(o.progress)+'%)</span></div>'+krLines;
      }).join('');
    }

    TX.drawer({
      title: name,
      subtitle: (emp? emp.orgName+' · '+emp.jobTitle : (org? org+(duty?' · '+duty:'') : '구성원 상세')),
      body: '<h4>기본 정보</h4>'+basic + evalHtml + histHtml + objHtml
    });
  }

  /* ---------- 360 result drawer (msf .btn-res) ---------- */
  function open360Drawer(btn){
    var card = btn.closest('.mcard');
    var title = card ? txt(card.querySelector('.mtitle')).replace(/종료$/,'').trim() : '360 진단';
    var target = card ? txt(card.querySelector('.grp.tgt .who')) : '';
    var raters = card ? txt(card.querySelector('.grp .who.raters')) || txt(card.querySelectorAll('.grp .who')[1]) : '';
    var pctRaw = card ? (card.querySelector('.gauge') && card.querySelector('.gauge').style.getPropertyValue('--pct')) : '';
    var pct = parseInt(pctRaw,10); if(isNaN(pct)) pct=100;
    var ongoing = btn.textContent.indexOf('이어서')>=0;

    var comps = D.competencies||[];
    var dims = comps.map(function(c,i){
      var score = (3.4 + ((hash(target+c.dimension_id)%16)/10)).toFixed(1); // 3.4~4.9
      var facet = (c.facets&&c.facets.length)? c.facets[hash(c.dimension_id)%c.facets.length] : '';
      return {name:c.name, id:c.dimension_id, desc:c.description, score:score, facet:facet};
    });
    var avg = dims.length ? (dims.reduce(function(a,d){return a+parseFloat(d.score);},0)/dims.length).toFixed(2) : '-';

    var dimHtml = dims.map(function(d){
      var w = Math.round((parseFloat(d.score)/5)*100);
      return '<div style="margin:12px 0 4px"><div style="display:flex;justify-content:space-between;font-size:13.5px;font-weight:700;color:var(--ink)">'+
        '<span>'+esc(d.id)+'. '+esc(d.name)+'</span><span style="color:var(--blue)">'+esc(d.score)+'/5</span></div>'+
        '<div style="height:7px;border-radius:4px;background:var(--soft);margin:6px 0"><i style="display:block;height:100%;border-radius:4px;width:'+w+'%;background:var(--blue)"></i></div>'+
        '<div style="font-size:12px;color:var(--ink-3)">'+esc(d.desc)+(d.facet?(' · 강점: '+esc(d.facet)):'')+'</div></div>';
    }).join('');

    if(ongoing){
      TX.drawer({ title:'360 피드백 진행 상황', subtitle: esc(title),
        body:'<h4>응답 진행률</h4>'+
          '<div class="tx-kpi"><div class="c"><div class="n">'+pct+'%</div><div class="l">완료율</div></div>'+
          '<div class="c"><div class="n">'+(raters? raters.split(',').length : 3)+'</div><div class="l">평가자 수</div></div>'+
          '<div class="c"><div class="n">'+(pct>=100?'완료':'진행중')+'</div><div class="l">상태</div></div></div>'+
          rowsHtml([['대상자',target],['평가자',raters]])+
          '<div style="margin-top:16px;font-size:13px;color:var(--ink-2);line-height:1.6">아직 응답하지 않은 평가자에게 리마인드를 보낼 수 있습니다.</div>'
      });
      return;
    }
    TX.drawer({ title: title||'360 진단 결과', subtitle:'종합 결과 비교',
      body:'<h4>종합</h4>'+
        '<div class="tx-kpi"><div class="c"><div class="n">'+esc(avg)+'</div><div class="l">평균 (5점)</div></div>'+
        '<div class="c"><div class="n">'+pct+'%</div><div class="l">응답률</div></div>'+
        '<div class="c"><div class="n">'+(raters? raters.split(',').length : 1)+'</div><div class="l">평가자</div></div></div>'+
        rowsHtml([['대상자',target],['평가자',raters]])+
        '<h4>역량 차원별 결과</h4>'+dimHtml
    });
  }

  /* ---------- evaluation writing modal (appr .ap-btn) ---------- */
  function openEvalWriteModal(btn){
    var cell = btn.closest('.ap-cell');
    var subject = cell ? txt(cell.querySelector('.ap-nm')).replace(/[✓]$/,'').trim() : '평가 대상자';
    var comps = D.competencies||[];
    var opts = '<option value="">점수 선택</option>'+
      ['5 - 매우 우수','4 - 우수','3 - 보통','2 - 미흡','1 - 부족'].map(function(o){ return '<option>'+o+'</option>'; }).join('');
    var body = '<div style="font-size:13px;color:var(--ink-2);margin-bottom:4px">대상자: <b style="color:var(--ink)">'+esc(subject)+'</b></div>';
    (comps.length?comps:[{dimension_id:'',name:'종합 의견',description:''}]).forEach(function(c){
      body += '<div style="border-top:1px solid var(--line-2);padding-top:10px;margin-top:10px">'+
        TX.field((c.dimension_id?c.dimension_id+'. ':'')+c.name+ (c.description?' — '+c.description:''),
          '<select>'+opts+'</select>') +
        TX.field('코멘트','<textarea placeholder="근거를 입력하세요"></textarea>')+'</div>';
    });
    TX.modal({
      title:'평가 작성', wide:true, body:body,
      actions:[
        {label:'취소', kind:'ghost'},
        {label:'제출', kind:'primary', onClick:function(){
          // optimistic: flip status dot to done, morph button to 응답 확인
          if(cell){
            var dot = cell.querySelector('.sdot');
            if(dot){ dot.className='sdot s-done'; dot.textContent='✓'; }
            btn.textContent='응답 확인'; btn.className='ap-btn-o';
          }
          TX.toast(subject+' 평가를 제출했습니다.', 'ok');
        }}
      ]
    });
  }

  /* ---------- submitted eval drawer (appr .ap-btn-o) ---------- */
  function openEvalResultDrawer(btn){
    var cell = btn.closest('.ap-cell');
    var subject = cell ? txt(cell.querySelector('.ap-nm')).replace(/[✓]$/,'').trim() : '평가 대상자';
    var ev = empByName(subject) ? (evalByEmp(empByName(subject).emp_id)||evalForSeed(subject)) : evalForSeed(subject);
    var comp = ev && ev.components ? ev.components : null;
    var compHtml = comp ? rowsHtml([
      ['목표 달성 (norm)', comp.achievement_norm+' 점'],
      ['피어 리뷰 (norm)', comp.peer_strength_norm+' 점'],
      ['실행 일관성 (norm)', comp.exec_consistency_norm+' 점']
    ]) : '';
    TX.drawer({ title:'제출된 평가', subtitle: esc(subject),
      body: (ev?
        '<div class="tx-kpi"><div class="c"><div class="n">'+esc(ev.grade)+'</div><div class="l">등급</div></div>'+
        '<div class="c"><div class="n">'+esc(ev.weighted_score)+'</div><div class="l">종합</div></div></div>'+
        '<h4>구성 요소</h4>'+compHtml+
        '<h4>총평</h4><div style="font-size:13px;color:var(--ink-2);line-height:1.6">'+esc(ev.rationale_summary)+'</div>'
        : '<div style="color:var(--ink-3)">제출된 평가 데이터를 찾을 수 없습니다.</div>')
    });
  }

  /* ---------- review write / view (perf .rv-act) ---------- */
  function openReviewWrite(row){
    var tt = row ? txt(row.querySelector('.tt')) : '리뷰';
    TX.modal({ title:'리뷰 작성', body:
      '<div style="font-size:13px;color:var(--ink-2);margin-bottom:4px">'+esc(tt)+'</div>'+
      TX.field('총평','<textarea placeholder="리뷰 내용을 입력하세요"></textarea>')+
      TX.field('종합 등급','<select><option>S</option><option selected>A</option><option>B</option><option>C</option><option>D</option></select>'),
      actions:[{label:'취소',kind:'ghost'},{label:'제출',kind:'primary',onClick:function(){ TX.toast('리뷰를 제출했습니다.','ok'); }}]
    });
  }
  function openReviewView(row){
    var tt = row ? txt(row.querySelector('.tt')) : '리뷰';
    var ev = evalForSeed(tt+txt(row.querySelector('.nm')));
    TX.drawer({ title:'리뷰 결과', subtitle:esc(tt),
      body:'<div class="tx-kpi"><div class="c"><div class="n">'+esc(ev.grade)+'</div><div class="l">등급</div></div>'+
        '<div class="c"><div class="n">'+esc(ev.weighted_score)+'</div><div class="l">점수</div></div></div>'+
        '<h4>총평</h4><div style="font-size:13px;color:var(--ink-2);line-height:1.6">'+esc(ev.rationale_summary)+'</div>'
    });
  }

  /* ---------- generic record-row drawer (승인/결재 tables) ---------- */
  function openGenericRowDrawer(tr){
    var table = tr.closest('table');
    var heads = table ? Array.prototype.map.call(table.querySelectorAll('thead th'), txt) : [];
    var cells = Array.prototype.map.call(tr.querySelectorAll('td'), txt);
    var pairs = cells.map(function(v,i){ return [heads[i]||('항목 '+(i+1)), v]; }).filter(function(p){ return p[1]; });
    if(!pairs.length) return;
    TX.drawer({ title: pairs[0][1] || '문서 상세', subtitle:'문서 상세',
      body:'<h4>상세</h4>'+rowsHtml(pairs) });
  }

  /* ---------- global search modal (gnb 검색) ---------- */
  function openSearchModal(){
    var wrap = document.createElement('div');
    wrap.innerHTML = TX.field('구성원 검색','<input type="text" placeholder="이름 · 직무 · 소속으로 검색" autofocus>')+
      '<div class="tx-search-res" style="max-height:320px;overflow:auto;margin-top:4px"></div>';
    var input = wrap.querySelector('input');
    var res = wrap.querySelector('.tx-search-res');
    function render(q){
      q=(q||'').trim();
      var list = (D.employees||[]);
      if(q) list = list.filter(function(e){ return (e.name+e.jobTitle+e.orgName+e.emp_id).indexOf(q)>=0; });
      list = list.slice(0,30);
      if(!list.length){ res.innerHTML='<div style="padding:16px;color:var(--ink-3);font-size:13px">검색 결과가 없습니다.</div>'; return; }
      res.innerHTML = list.map(function(e){
        return '<div class="tx-drow" data-emp="'+esc(e.emp_id)+'" style="cursor:pointer">'+
          '<span class="k">'+esc(e.name)+' <span style="color:var(--ink-4)">'+esc(e.level_kr)+'</span></span>'+
          '<span class="v" style="font-weight:500;color:var(--ink-3)">'+esc(e.orgName)+' · '+esc(e.jobTitle)+'</span></div>';
      }).join('');
    }
    render('');
    input.addEventListener('input', function(){ render(input.value); });
    res.addEventListener('click', function(e){
      var r = e.target.closest('[data-emp]'); if(!r) return;
      var emp = (D.employees||[]).find(function(x){ return x.emp_id===r.getAttribute('data-emp'); });
      if(!emp) return;
      var ev = evalByEmp(emp.emp_id)||evalForSeed(emp.emp_id);
      TX.drawer({ title:emp.name, subtitle:emp.orgName+' · '+emp.jobTitle,
        body:'<h4>기본 정보</h4>'+rowsHtml([
          ['직무',emp.jobTitle],['소속',emp.orgName],['레벨',emp.level_kr+' / '+emp.level],
          ['입사일',emp.join_date],['근속',emp.tenure_years+'년'],['매니저',emp.managerName||'-']
        ])+ (ev? '<h4>현재 평가</h4>'+rowsHtml([['등급',ev.grade],['종합 점수',ev.weighted_score]]) : '')
      });
    });
    TX.modal({ title:'검색', body:wrap, actions:[{label:'닫기',kind:'ghost'}] });
    setTimeout(function(){ input.focus(); }, 50);
  }

  /* ---------- notifications drawer (gnb 알림) ---------- */
  function openNotifDrawer(){
    var notifs = [
      ['근무','최한울-테스트2님이 근무계획 수립을 신청했습니다.','오후 6:57'],
      ['평가','FY2026 평가 작성 마감이 3일 남았습니다.','오전 9:10'],
      ['360','직책자 진단 결과가 도착했습니다.','어제'],
      ['목표','최인기님이 목표를 수정했습니다.','7월 9일'],
      ['결재','승인이 필요한 문서가 26건 있습니다.','7월 8일']
    ];
    TX.drawer({ title:'알림', subtitle:'읽지 않은 알림 '+notifs.length+'건',
      body: notifs.map(function(n){
        return '<div style="display:flex;gap:10px;padding:12px 0;border-bottom:1px solid var(--line-2)">'+
          '<span class="tag-r" style="flex:none">'+esc(n[0])+'</span>'+
          '<div style="flex:1"><div style="font-size:13.5px;color:var(--ink)">'+esc(n[1])+'</div>'+
          '<div style="font-size:12px;color:var(--ink-3);margin-top:3px">'+esc(n[2])+'</div></div></div>';
      }).join('')
    });
  }

  /* ---------- info-i tooltip popover ---------- */
  var INFO = {
    '근무일':'해당 기간 중 실제 출근한 일수입니다.',
    '근무시간':'출근~퇴근 사이의 실제 근무한 시간 합계입니다.',
    '기타 근무시간':'외근·출장 등 별도로 인정되는 근무시간입니다.',
    '인정 근무시간':'회사 규정상 근무로 인정되는 총 시간입니다.',
    '휴가사용':'해당 기간에 사용한 휴가 시간입니다.',
    '휴일 근무시간':'휴일에 근무한 시간으로 가산 대상입니다.',
    '연장 근무시간':'소정근로시간을 초과한 연장근무 시간입니다.',
    '야간 근무시간':'22시~익일 6시 사이의 야간근무 시간입니다.',
    '테이블':'선택한 분석 조건에 따라 집계된 인원 피벗 테이블입니다.'
  };
  function openInfoTip(anchor){
    var label = txt(anchor.closest('.k')||anchor.parentElement).replace(/\s*i\s*$/,'').trim();
    var msg = INFO[label] || (label? label+' 항목에 대한 집계 기준 설명입니다.' : '집계 기준에 대한 설명입니다.');
    TX.menu(anchor, [{label: msg}]);
  }

  /* ---------- action modals ---------- */
  function leaveRequestModal(){
    TX.modal({ title:'근무/휴가 신청',
      body: TX.field('신청 유형','<select><option>연차 휴가</option><option>반차</option><option>근무 신청</option><option>재택근무</option></select>')+
        TX.field('기간','<input type="text" placeholder="2026.07.15 ~ 2026.07.15">')+
        TX.field('사유','<textarea placeholder="사유를 입력하세요"></textarea>'),
      actions:[{label:'취소',kind:'ghost'},{label:'신청',kind:'primary',onClick:function(){ TX.toast('신청이 접수되었습니다.','ok'); }}]
    });
  }
  function simpleFormModal(title, fields, okLabel, okMsg){
    TX.modal({ title:title, body: fields.map(function(f){ return TX.field(f[0], f[1]); }).join(''),
      actions:[{label:'취소',kind:'ghost'},{label:okLabel||'저장',kind:'primary',onClick:function(){ TX.toast(okMsg||'저장되었습니다.','ok'); }}] });
  }

  /* ==================================================================
     MAIN DELEGATED CLICK HANDLER
  ================================================================== */
  function onClick(e){
    var t = e.target;
    var scr = screenOf(t);
    var el;

    /* ---- GNB right icons + avatar (category 5) ---- */
    el = t.closest('.gnb-right .i');
    if(el){
      var title = el.getAttribute('title');
      stop(e);
      if(title==='검색') openSearchModal();
      else openNotifDrawer();
      return;
    }
    el = t.closest('.gnb-right .ava');
    if(el){ stop(e);
      TX.menu(el, [
        {label:'프로필', onClick:function(){ var u=(D.meta&&D.meta.currentUser)||{}; TX.toast((u.name||'사용자')+' · '+(u.orgName||''),'');}},
        {label:'설정', onClick:function(){ TX.toast('설정 화면은 준비 중입니다.'); }},
        {sep:true},
        {label:'로그아웃', danger:true, onClick:function(){ TX.toast('로그아웃되었습니다.'); }}
      ]);
      return;
    }

    /* ---- subnav close ✕ (category 8) ---- */
    el = t.closest('.subnav .close');
    if(el){ stop(e);
      var aside = el.closest('.subnav'); if(aside) aside.style.display='none';
      TX.toast('메뉴를 접었습니다.');
      return;
    }

    /* ---- kebab menus ⋮ (category 5) ---- */
    el = t.closest('.wp-kebab, .fb-dots, .selectbar, .statnav .nb, .wcard .statnav .nb');
    if(el){
      // selectbar → org filter menu; statnav .nb → period nav toast; kebab → item menu
      if(el.classList.contains('selectbar')){ stop(e);
        TX.menu(el, [
          {label:'전체 구성원', onClick:function(){ TX.toast('전체 구성원'); }},
          {label:'우리 조직', onClick:function(){ TX.toast('우리 조직으로 필터'); }},
          {label:'즐겨찾기', onClick:function(){ TX.toast('즐겨찾기'); }}
        ]);
        return;
      }
      if(el.classList.contains('nb')){ stop(e); TX.toast('기간을 이동했습니다.'); return; }
      // .wp-kebab / .fb-dots
      stop(e);
      TX.menu(el, [
        {label:'수정', onClick:function(){ TX.toast('수정 화면으로 이동합니다.'); }},
        {label:'공유', onClick:function(){ TX.toast('공유 링크를 복사했습니다.','ok'); }},
        {sep:true},
        {label:'삭제', danger:true, onClick:function(){ TX.confirm('삭제','정말 삭제하시겠습니까?',function(){ TX.toast('삭제되었습니다.'); },'삭제'); }}
      ]);
      return;
    }

    /* ---- info-i tooltip (category 7) ---- */
    el = t.closest('.info-i');
    if(el){ stop(e); openInfoTip(el); return; }

    /* ---- preset chip (category 5) ---- */
    el = t.closest('.preset');
    if(el){ stop(e);
      TX.menu(el, [
        {label:'기본 대시보드', onClick:function(){ TX.toast('기본 대시보드'); }},
        {label:'새 대시보드 만들기', onClick:function(){ simpleFormModal('새 대시보드',[['이름','<input type="text" placeholder="대시보드 이름">']],'생성','대시보드를 생성했습니다.'); }}
      ]);
      return;
    }

    /* ================= INSA 관리 (hrm) ================= */
    if(scr==='s-hrm'){
      el = t.closest('.mlink');
      if(el){ stop(e); openEmployeeDrawer(el.closest('tr')); return; }
      el = t.closest('.btn-search');
      if(el){ stop(e); openSearchModal(); return; }
      el = t.closest('.freset');
      if(el){ stop(e); TX.toast('검색 조건을 초기화했습니다.'); return; }
      el = t.closest('.fmore');
      if(el){ stop(e); TX.toast('상세 조건 패널을 열었습니다.'); return; }
      el = t.closest('.btn-xls, .btn-dl');
      if(el){ stop(e); TX.toast('다운로드를 시작합니다.','ok'); return; }
      el = t.closest('.b-blue');
      if(el){ stop(e); TX.toast('조회했습니다. (재직 현황 기준)','ok'); return; }
      el = t.closest('.b-line');
      if(el){ stop(e); TX.toast('필터를 재설정했습니다.'); return; }
      el = t.closest('.b-dark');
      if(el){ stop(e); simpleFormModal('분석 조건 저장',[['조건 이름','<input type="text" placeholder="예: 재직자 성별 현황">']],'저장','조건을 저장했습니다.'); return; }
      el = t.closest('.pg-nav button, .pager2 button');
      if(el){ stop(e); TX.toast('페이지를 이동했습니다.'); return; }
      el = t.closest('.cond-chip .x, .ai-chip .x, .fbox .clr');
      if(el){ stop(e); var chip=el.closest('.cond-chip, .ai-chip'); if(chip){ chip.remove(); TX.toast('필터를 제거했습니다.'); } else TX.toast('필터를 제거했습니다.'); return; }
      el = t.closest('.fbox');
      if(el){ stop(e); TX.toast('필터 옵션을 선택하세요.'); return; }
      // htab / depth-seg / seg2 handled by existing script — do not touch
    }

    /* ================= 성과관리 (perf) ================= */
    if(scr==='s-perf'){
      el = t.closest('.rv-act');
      if(el){ stop(e);
        var rvRow = el.closest('.rv-row');
        if(el.classList.contains('ghost')||txt(el)==='확인') openReviewView(rvRow); else openReviewWrite(rvRow);
        return;
      }
      el = t.closest('.mt-item');
      if(el){ stop(e);
        TX.drawer({ title:txt(el.querySelector('.nm'))||'1:1 미팅', subtitle:'1:1 미팅',
          body:'<h4>미팅 정보</h4>'+rowsHtml([['상대',txt(el.querySelector('.nm'))],['일시',txt(el.querySelector('.date'))],['안건','1건'],['메모','0건']])+
            '<div style="margin-top:14px;font-size:13px;color:var(--ink-2);line-height:1.6">지난 1:1 미팅의 안건과 후속 조치를 확인할 수 있습니다.</div>' });
        return;
      }
      el = t.closest('.btn-blue');
      if(el){ stop(e); var b=txt(el);
        if(b.indexOf('목표')>=0) simpleFormModal('목표 생성',[['목표명','<input type="text" placeholder="목표를 입력하세요">'],['유형','<select><option>조직</option><option>개인</option></select>'],['설명','<textarea></textarea>']],'생성','목표를 생성했습니다.');
        else if(b.indexOf('피드백')>=0) simpleFormModal('피드백 보내기',[['받는 사람','<input type="text" placeholder="이름 검색">'],['내용','<textarea placeholder="피드백 내용"></textarea>']],'보내기','피드백을 보냈습니다.');
        else if(b.indexOf('리뷰')>=0) simpleFormModal('리뷰 생성',[['리뷰명','<input type="text" placeholder="리뷰 양식 이름">'],['연도','<input type="text" value="2026">']],'생성','리뷰를 생성했습니다.');
        else TX.toast('처리했습니다.','ok');
        return;
      }
      el = t.closest('.ghost-btn');
      if(el){ stop(e); var g=txt(el);
        if(g.indexOf('가중치')>=0) simpleFormModal('목표 가중치 설정',[['전체 가중치 합','<input type="text" value="100%">'],['비고','<textarea></textarea>']],'저장','가중치를 저장했습니다.');
        else TX.toast(g+' 화면은 준비 중입니다.');
        return;
      }
      el = t.closest('.plus');
      if(el){ stop(e); simpleFormModal('1:1 미팅 생성',[['상대','<input type="text" placeholder="이름 검색">'],['일시','<input type="text" placeholder="2026.07.16 14:00">']],'생성','1:1 미팅을 생성했습니다.'); return; }
      el = t.closest('.filt');
      if(el){ stop(e); TX.toast('필터를 적용합니다.'); return; }
      el = t.closest('.fb-more, .mt-more, .rv-sort span');
      if(el){ stop(e);
        if(el.closest('.rv-sort')){ var grp=el.closest('.rv-sort'); grp.querySelectorAll('span').forEach(function(s){ if(!s.classList.contains('dot')) s.classList.toggle('on', s===el); }); TX.toast(txt(el)+'으로 정렬'); }
        else TX.toast('모든 항목을 불러왔습니다.');
        return;
      }
      // pilltabs & segtabs already toggle .on via existing script → add informational toast only (coexist, no stop)
      el = t.closest('.pilltabs button, .segtabs button');
      if(el){ TX.toast(txt(el)+' 기준으로 표시합니다.'); return; }
    }

    /* ================= 360 진단 (msf) ================= */
    if(scr==='s-msf'){
      el = t.closest('.btn-res');
      if(el){ stop(e); open360Drawer(el); return; }
      el = t.closest('.btn-req');
      if(el){ stop(e); simpleFormModal('360 피드백 요청',[['대상자','<input type="text" placeholder="이름 검색">'],['평가자','<input type="text" placeholder="평가자 추가">'],['마감일','<input type="text" placeholder="2026.07.31">']],'요청','360 피드백을 요청했습니다.'); return; }
      el = t.closest('.btn-set');
      if(el){ stop(e); TX.menu(el, [
        {label:'평가자 직접 지정', onClick:function(){ TX.toast('평가자 지정 모드'); }},
        {label:'자동 배정', onClick:function(){ TX.toast('평가자를 자동 배정했습니다.','ok'); }}
      ]); return; }
      el = t.closest('.filt');
      if(el){ stop(e); TX.toast('필터를 적용합니다.'); return; }
      // subtabs / sortset handled by existing script
    }

    /* ================= 평가관리 (appr) ================= */
    if(scr==='s-appr'){
      el = t.closest('.ap-btn');
      if(el){ stop(e); openEvalWriteModal(el); return; }
      el = t.closest('.ap-btn-o');
      if(el){ stop(e); openEvalResultDrawer(el); return; }
      el = t.closest('.ts-join');
      if(el){ stop(e); var ts=el.closest('.ts-card'); var nm=ts?txt(ts.querySelector('.ts-title')):'세션';
        TX.confirm('탈렌트 세션 참여', nm+'에 참여하시겠습니까?', function(){ TX.toast('세션에 참여했습니다.','ok'); }, '참여'); return; }
      el = t.closest('.ap-filter');
      if(el){ stop(e); TX.toast('평가 필터를 적용합니다.'); return; }
      // ap-tabs / ts-ftabs handled by existing script
    }

    /* ================= 근무관리 (att) ================= */
    if(scr==='s-att'){
      el = t.closest('.btn-dark');
      if(el){ stop(e); leaveRequestModal(); return; }
      el = t.closest('.lvrow');
      if(el){ stop(e); leaveRequestModal(); return; }
      el = t.closest('.cal .nav, .cal .today');
      if(el){ stop(e); TX.toast('달을 이동했습니다.'); return; }
      el = t.closest('.segtabs button');
      if(el){ stop(e); toggleGroupOn(el, '.segtabs'); TX.toast(txt(el)+' 기준'); return; }
    }

    /* ================= 업무관리 (work) ================= */
    if(scr==='s-work'){
      el = t.closest('.sc-write');
      if(el){ stop(e); simpleFormModal('스크럼 작성',[['오늘 예정 업무','<textarea placeholder="오늘 할 일"></textarea>'],['이슈/블로커','<textarea></textarea>']],'등록','스크럼을 등록했습니다.'); return; }
      el = t.closest('.sc-add');
      if(el){ stop(e); simpleFormModal('스크럼보드 추가',[['보드 이름','<input type="text" placeholder="보드 이름">']],'추가','스크럼보드를 추가했습니다.'); return; }
      el = t.closest('.sc-sel');
      if(el){ stop(e); TX.menu(el, [{label:'보드 설정',onClick:function(){TX.toast('보드 설정');}},{label:'멤버 관리',onClick:function(){TX.toast('멤버 관리');}}]); return; }
      el = t.closest('.sc-filter');
      if(el){ stop(e); TX.toast('필터를 적용합니다.'); return; }
      el = t.closest('button');
      if(el && txt(el).indexOf('업무보드 추가')>=0){ stop(e); simpleFormModal('업무보드 추가',[['보드 이름','<input type="text" placeholder="보드 이름">'],['공개 범위','<select><option>전체</option><option>비공개</option></select>']],'추가','업무보드를 추가했습니다.'); return; }
      // work .segtabs (wpanel) handled by existing script
    }

    /* ================= 승인/결재 (wf) ================= */
    if(scr==='s-wf'){
      el = t.closest('.wf-abtn');
      if(el){ stop(e); var act=txt(el);
        if(act==='승인'){ TX.confirm('승인','선택한 문서를 승인하시겠습니까?',function(){ TX.toast('승인 처리했습니다.','ok'); },'승인'); }
        else if(act==='반려'){ TX.modal({ title:'반려', body:TX.field('반려 사유','<textarea placeholder="반려 사유를 입력하세요"></textarea>'),
          actions:[{label:'취소',kind:'ghost'},{label:'반려',kind:'danger',onClick:function(){ TX.toast('반려 처리했습니다.'); }}] }); }
        else TX.toast('읽음 처리했습니다.','ok');
        return;
      }
      el = t.closest('.wf-write');
      if(el){ stop(e); simpleFormModal('문서 작성',[['문서 유형','<select><option>휴가 신청서</option><option>근무 신청서</option><option>기타</option></select>'],['제목','<input type="text">'],['내용','<textarea></textarea>']],'작성','문서를 작성했습니다.'); return; }
      el = t.closest('.wf-pills button');
      if(el){ stop(e); toggleGroupOn(el, '.wf-pills'); TX.toast(txt(el).replace(/\s*\d+\s*$/,'').trim()+' 문서만 표시합니다.'); return; }
      el = t.closest('.wf-filter .fi');
      if(el){ stop(e); var fg=el.closest('.wf-filter'); fg.querySelectorAll('.fi').forEach(function(f){ f.classList.toggle('on', f===el); }); TX.toast('필터를 적용했습니다.'); return; }
      el = t.closest('table tbody tr');
      if(el && !t.closest('button, input, .cbx')){ stop(e); openGenericRowDrawer(el); return; }
    }

    /* ================= HOME ================= */
    if(scr==='s-home'){
      el = t.closest('.segtabs button');
      if(el){ stop(e); toggleGroupOn(el, '.segtabs'); TX.toast(txt(el)+' 기준으로 표시합니다.'); return; }
      el = t.closest('.btn-dark');
      if(el){ stop(e); leaveRequestModal(); return; }
      el = t.closest('.ghost-btn');
      if(el){ stop(e); var hg=txt(el);
        if(hg.indexOf('휴가')>=0) leaveRequestModal();
        else TX.toast(hg+' 화면은 준비 중입니다.');
        return;
      }
      el = t.closest('.more');
      if(el){ stop(e); TX.toast('모든 항목을 불러왔습니다.'); return; }
      el = t.closest('h3 .chev, .ct .chev, .chev');
      if(el){ stop(e); TX.toast('상세 화면은 준비 중입니다.'); return; }
    }
  }

  /* ---- bind once ---- */
  if(!document.__txReviveBound){
    document.__txReviveBound = true;
    document.addEventListener('click', onClick, false);
  }

  window.TXRevive = { version: '1.0.0' };
})();
