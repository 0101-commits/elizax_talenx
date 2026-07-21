/* ============================================================
   tx_nav.js — elizax 내비게이션 intent 라우터
   "목표 설정 화면으로 넘어가줘" → 성과관리 > 목표 탭 전환.
   - EZNav.resolve(text): 자연어 → {s, p, label} | null
   - EZNav.go(s, p): 실제 GNB/서브내비 클릭으로 화면 전환
   - EZNav.extractMarker(text): LLM 응답의 @@NAV{...}@@ 마커 파싱
   외부 의존성 없음. window.EZNav 노출.
   ============================================================ */
(function () {
  "use strict";

  var GNB_LABEL = {
    home: "홈", work: "업무관리", perf: "성과관리", msf: "360 진단",
    appr: "평가관리", pay: "급여관리", att: "근무관리", hrm: "인사관리", wf: "신청/승인"
  };
  var TAB_LABEL = {
    work: ["업무보드", "스크럼보드"],
    perf: ["목표 현황", "피드백", "1:1 미팅", "리뷰"],
    appr: ["평가 매트릭스", "인재 리뷰"],
    pay: ["내 급여", "연말정산"],
    att: ["내 근무", "내 휴가", "구성원 근무", "구성원 휴가", "근무스케줄", "위치정보 제공 조회", "연차촉진"],
    hrm: ["사용자 정보", "구성원 정보", "인재 검색", "인원 현황"],
    wf: ["받은 문서", "보낸 문서", "서명 문서"]
  };

  /* 화면/탭 키워드 → 목적지. 순서 중요: 구체적 패턴 먼저. */
  var ROUTES = [
    { re: /(목표\s*(설정|수립|현황|관리)?|OKR|오케이알)/i, s: "perf", p: 0 },
    { re: /(1\s*[:온]\s*1|원온원|1on1|미팅)/i, s: "perf", p: 2 },
    { re: /피드백/, s: "perf", p: 1 },
    { re: /리뷰/, s: "perf", p: 3 },
    { re: /(성과\s*관리|성과)/, s: "perf", p: 0 },
    { re: /(평가\s*매트릭스|평가\s*관리|평가)/, s: "appr", p: 0 },
    { re: /(인재\s*리뷰|탈렌트|talent)/i, s: "appr", p: 1 },
    { re: /360/, s: "msf", p: null },
    { re: /(스크럼)/, s: "work", p: 1 },
    { re: /(업무\s*보드|업무\s*관리|업무)/, s: "work", p: 0 },
    { re: /(연말\s*정산)/, s: "pay", p: 1 },
    { re: /(급여|월급|페이)/, s: "pay", p: 0 },
    { re: /(휴가|연차)/, s: "att", p: 1 },
    { re: /(근무\s*스케줄)/, s: "att", p: 4 },
    { re: /(근무|출퇴근|근태)/, s: "att", p: 0 },
    { re: /(인재\s*검색)/, s: "hrm", p: 2 },
    { re: /(인원\s*현황)/, s: "hrm", p: 3 },
    { re: /(구성원\s*정보)/, s: "hrm", p: 1 },
    { re: /(내\s*정보|사용자\s*정보|인사\s*관리|인사)/, s: "hrm", p: 0 },
    { re: /(받은\s*문서)/, s: "wf", p: 0 },
    { re: /(보낸\s*문서)/, s: "wf", p: 1 },
    { re: /(서명)/, s: "wf", p: 2 },
    { re: /(승인|결재|신청)/, s: "wf", p: 0 },
    { re: /(홈|대시보드|메인)/, s: "home", p: null }
  ];

  /* 이동 의도 판정: 강한 동사는 단독 OK, 약한 동사(보여줘/열어/띄워)는
     화면·탭·메뉴·페이지 단어 동반 시에만 내비로 인정 (데이터 질문과 구분) */
  var GO_STRONG = /(넘어가|이동|가\s*줘|가줘|가자|전환|들어가|접속|탭\s*으로|화면\s*으로|메뉴\s*로|페이지\s*로|으로\s*가|로\s*가)/;
  var GO_WEAK = /(열어|보여\s*줘|보여줘|띄워|바꿔)/;
  var SCREEN_WORD = /(화면|탭|메뉴|페이지)/;
  function hasGoIntent(t) {
    if (GO_STRONG.test(t)) return true;
    return GO_WEAK.test(t) && SCREEN_WORD.test(t);
  }

  function labelOf(s, p) {
    var lab = GNB_LABEL[s] || s;
    if (p != null && TAB_LABEL[s] && TAB_LABEL[s][p]) lab += " › " + TAB_LABEL[s][p];
    return lab;
  }

  /* 자연어 → 목적지. 이동 의도가 없으면 null (일반 질문은 LLM으로). */
  function resolve(text) {
    var t = String(text || "").trim();
    if (!t || !hasGoIntent(t)) return null;
    for (var i = 0; i < ROUTES.length; i++) {
      if (ROUTES[i].re.test(t)) {
        var r = ROUTES[i];
        return { s: r.s, p: r.p, label: labelOf(r.s, r.p) };
      }
    }
    return null;
  }

  /* 실제 화면 전환 — 실 컨트롤 클릭 (tx_fix_home.js nav()와 동일 전략) */
  function go(key, subP) {
    if (key === "home") {
      var logo = document.querySelector(".logo");
      if (logo) logo.click();
      return true;
    }
    var b = document.querySelector('#gnb [data-s="' + key + '"]') ||
            document.querySelector('.gnb-menu [data-s="' + key + '"]');
    if (!b) return false;
    b.click();
    if (subP != null) {
      setTimeout(function () {
        try {
          var a = document.querySelector("#s-" + key + ' .subnav a[data-p="' + subP + '"]');
          if (a) a.click();
        } catch (e) { /* ignore */ }
      }, 60);
    }
    return true;
  }

  /* LLM 응답 마커: @@NAV{"s":"perf","p":0}@@ → {clean, nav} */
  function extractMarker(text) {
    var t = String(text || "");
    var m = t.match(/@@NAV(\{[\s\S]*?\})@@/);
    if (!m) return { clean: t, nav: null };
    var nav = null;
    try {
      var j = JSON.parse(m[1]);
      if (j && j.s && GNB_LABEL[j.s]) nav = { s: j.s, p: (j.p == null ? null : Number(j.p)), label: labelOf(j.s, j.p == null ? null : Number(j.p)) };
    } catch (e) { /* ignore */ }
    return { clean: t.replace(/@@NAV\{[\s\S]*?\}@@/g, "").replace(/\n{3,}/g, "\n\n").trim(), nav: nav };
  }

  window.EZNav = { resolve: resolve, go: go, extractMarker: extractMarker, labelOf: labelOf };
})();
