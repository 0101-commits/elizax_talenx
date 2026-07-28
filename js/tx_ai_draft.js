/* ==========================================================================
 * tx_ai_draft.js — 재사용 근거초안 모듈 (window.EZDraft)
 *
 * [기획 스펙 — F4 평가 작성 × AI 근거초안]
 *  - tx_agent.js QW3(qw3Draft) 프롬프트 패턴 이식: 도구(get_objectives,
 *    get_checkins)로 대상자 실데이터를 먼저 조회 → 조회된 수치·사실만 인용해
 *    문장별 출처 마커 {{src:talenx|erp|rule|라벨}} 가 붙은 근거 문단을 생성.
 *  - 정지 원칙("근거가 조회되지 않으면 추정하지 말고 멈췄다고 말하라")과
 *    등급 확정 표현 금지(제안 어조)를 시스템 프롬프트에 유지.
 *  - DOM 무접촉 — 순수 콜백 API. hub·평가 작성 폼 양쪽에서 재사용 가능.
 *  - EZAI 미연결(ready() false)이면 onOffline() 호출 — 호출측이
 *    "AI 미연결" 표시를 책임진다(폴백 은폐 금지).
 *
 * [API]
 *  window.EZDraft.draftComment(opts) → boolean (시작=true / 오프라인=false)
 *    opts: {
 *      empId, empName,
 *      items: [{label, context}],            평가 항목(선택)
 *      onStart(),                            에이전트 루프 시작 직전
 *      onTool(name, label),                  도구 호출 — label은 한국어 표기
 *      onToolResult(name, result, summary),  도구 결과 요약(선택)
 *      onText(text, chipsHtml),              완성 텍스트 + 칩 치환 HTML
 *      onError(err),                         오류(빈 응답 포함)
 *      onOffline()                           AI 미연결
 *    }
 *  window.EZDraft.toChips(text)        → {{src:}} 마커를 칩 HTML로 치환(esc 먼저)
 *  window.EZDraft.splitSentences(text) → [{text, srcKind, srcLabel}] 문장 단위 분해
 *  window.EZDraft.chipHtml(kind,label) → 출처 칩 1개 HTML
 *  window.EZDraft.ready()              → AI 연결 + 도구 사용 가능 여부
 * ========================================================================== */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /* 게이트: EZAI 연결 + 로컬 도구 스키마 준비 (tx_agent.js aiLive 패턴) */
  function ready() {
    return !!(window.EZAI && EZAI.agent && EZAI.ready && EZAI.ready() &&
      window.EZTools && EZTools.schemas);
  }

  /* ---------- 출처 칩 CSS (모듈 내 주입 패턴) ---------- */
  function styleOnce() {
    if (document.getElementById('ezdft-style')) return;
    var s = document.createElement('style');
    s.id = 'ezdft-style';
    s.textContent =
      '.ezdft-src{display:inline-block;font-size:10.5px;font-weight:700;border-radius:5px;padding:1px 7px;margin:0 2px;white-space:nowrap;background:rgba(31,122,240,.08);color:#356CB5}' +
      '.ezdft-s-erp{background:rgba(194,65,12,.08);color:#C2410C}' +
      '.ezdft-s-rule{background:rgba(92,100,116,.12);color:#5C6474}';
    document.head.appendChild(s);
  }

  function chipHtml(kind, label) {
    styleOnce();
    return '<span class="ezdft-src ezdft-s-' + esc(kind) + '">' + esc(label) + '</span>';
  }

  var MARKER_RE_SRC = '\\{\\{src:(talenx|erp|rule)\\|([^}]{1,60})\\}\\}';

  /* {{src:}} 마커 → 칩 HTML. tx_agent.js:973-975 방식 그대로 — esc 먼저(XSS 안전). */
  function toChips(text) {
    return esc(String(text == null ? '' : text).trim())
      .replace(new RegExp(MARKER_RE_SRC, 'g'), function (m0, k, lab) { return chipHtml(k, lab); })
      .replace(/\n+/g, '<br>');
  }

  /* 문장 단위 분해 — 각 {{src:}} 마커가 직전 문장의 출처. 마커 없는 꼬리도 보존. */
  function splitSentences(text) {
    var out = [], re = new RegExp(MARKER_RE_SRC, 'g'), last = 0, m;
    var raw = String(text == null ? '' : text).trim();
    while ((m = re.exec(raw))) {
      var sent = raw.slice(last, m.index).replace(/\s+/g, ' ').trim();
      if (sent) out.push({ text: sent, srcKind: m[1], srcLabel: m[2] });
      last = re.lastIndex;
    }
    var rest = raw.slice(last).replace(/\s+/g, ' ').trim();
    if (rest) out.push({ text: rest, srcKind: '', srcLabel: '' });
    return out;
  }

  /* ---------- 근거초안 생성 (QW3 프롬프트 이식 — 대상자·항목 일반화) ---------- */
  function draftComment(opts) {
    opts = opts || {};
    if (!ready()) { if (opts.onOffline) opts.onOffline(); return false; }
    var empId = opts.empId || '', empName = opts.empName || empId || '대상자';
    var items = Array.isArray(opts.items) ? opts.items : [];
    var itemTxt = items.length
      ? ' · 평가 항목: ' + items.map(function (it) {
          it = it || {};
          return String(it.label || '') + (it.context ? '(' + it.context + ')' : '');
        }).filter(Boolean).join(', ')
      : '';
    if (opts.onStart) opts.onStart();
    EZAI.agent({
      maxTurns: 6, maxTokens: 900,
      system: '당신은 elizax — 평가 코멘트 근거초안 작성자입니다. 반드시 도구(get_objectives, get_checkins, 필요 시 get_employee_profile)로 대상자의 실데이터를 먼저 조회하고, ' +
        '조회 결과에 있는 수치·사실만 인용해 평가 코멘트 초안 2~4문장을 작성합니다. ' +
        '각 문장 끝에 출처 마커를 하나 붙입니다 — 형식: {{src:talenx|근거 라벨}} 또는 {{src:erp|근거 라벨}} 또는 {{src:rule|평가규정 라벨}}. ' +
        "근거가 조회되지 않으면 추정하지 말고 '기록이 없어 판단을 멈췄습니다'라고 씁니다(정지 원칙). " +
        '등급 확정 표현 금지 — 제안 어조 유지. 문장과 마커 외 머리말·설명 금지.',
      messages: [{
        role: 'user',
        content: '대상자: ' + empName + ' (' + empId + ')' + itemTxt +
          '. 목표·체크인 기록을 조회해 문장별 출처 마커가 붙은 근거 인용 코멘트 초안을 작성해줘.'
      }],
      onTool: function (name) {
        if (opts.onTool) {
          var label = (window.EZTools && EZTools.labelOf) ? EZTools.labelOf(name) : name;
          opts.onTool(name, label);
        }
      },
      onToolResult: function (name, r, summary) {
        if (opts.onToolResult) opts.onToolResult(name, r, summary);
      },
      onDone: function (text) {
        var t = String(text || '').trim();
        if (t) { if (opts.onText) opts.onText(t, toChips(t)); }
        else if (opts.onError) opts.onError('빈 응답 — 초안이 생성되지 않았습니다.');
      },
      onError: function (m) { if (opts.onError) opts.onError(m || '네트워크 오류'); }
    });
    return true;
  }

  window.EZDraft = {
    draftComment: draftComment,
    toChips: toChips,
    splitSentences: splitSentences,
    chipHtml: chipHtml,
    ready: ready
  };
})();
