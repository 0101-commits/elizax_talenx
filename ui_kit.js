/* ===== talenx mockup — interaction kit (data-independent) =====
   Native look via existing CSS tokens. Provides: toast, modal, drawer, menu, confirm.
   Namespaced under window.TX to avoid clashing with per-screen IIFEs. */
(function(){
  'use strict';
  var TX = window.TX = window.TX || {};

  /* ---- overlay root (created once) ---- */
  function root(){
    var r = document.getElementById('tx-overlay-root');
    if(!r){ r=document.createElement('div'); r.id='tx-overlay-root'; document.body.appendChild(r); }
    return r;
  }

  /* ---- toast ---- */
  TX.toast = function(msg, kind){
    var host = document.getElementById('tx-toasts');
    if(!host){ host=document.createElement('div'); host.id='tx-toasts'; root().appendChild(host); }
    var t=document.createElement('div'); t.className='tx-toast'+(kind?(' tx-'+kind):'');
    t.textContent=msg; host.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
    setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ t.remove(); },260); }, 2400);
  };

  /* ---- modal (centered dialog). opts:{title, body(html|node), actions:[{label,kind,onClick}], wide} ---- */
  TX.modal = function(opts){
    opts=opts||{};
    var back=document.createElement('div'); back.className='tx-back';
    var box=document.createElement('div'); box.className='tx-modal'+(opts.wide?' tx-wide':'');
    var h=document.createElement('div'); h.className='tx-mhead';
    h.innerHTML='<div class="tx-mtitle">'+(opts.title||'')+'</div><button class="tx-x" aria-label="닫기">✕</button>';
    var b=document.createElement('div'); b.className='tx-mbody';
    if(typeof opts.body==='string') b.innerHTML=opts.body; else if(opts.body) b.appendChild(opts.body);
    var f=document.createElement('div'); f.className='tx-mfoot';
    (opts.actions||[{label:'확인',kind:'primary'}]).forEach(function(a){
      var btn=document.createElement('button'); btn.className='tx-btn'+(a.kind?(' tx-'+a.kind):'');
      btn.textContent=a.label;
      btn.addEventListener('click',function(){ var keep=a.onClick&&a.onClick(box,back)===false; if(!keep) close(); });
      f.appendChild(btn);
    });
    box.appendChild(h); box.appendChild(b); if((opts.actions||[]).length!==0||opts.actions===undefined) box.appendChild(f);
    back.appendChild(box); root().appendChild(back);
    function close(){ back.classList.remove('show'); setTimeout(function(){ back.remove(); },200); }
    h.querySelector('.tx-x').addEventListener('click',close);
    back.addEventListener('click',function(e){ if(e.target===back) close(); });
    document.addEventListener('keydown',function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown',esc);} });
    requestAnimationFrame(function(){ back.classList.add('show'); });
    return { box:box, close:close, body:b };
  };

  /* ---- confirm ---- */
  TX.confirm = function(title, msg, onOk, okLabel){
    return TX.modal({ title:title, body:'<div class="tx-conf">'+(msg||'')+'</div>',
      actions:[{label:'취소',kind:'ghost'},{label:okLabel||'확인',kind:'primary',onClick:function(){ onOk&&onOk(); }}] });
  };

  /* ---- right-side detail drawer. opts:{title, subtitle, body(html|node), width} ---- */
  TX.drawer = function(opts){
    opts=opts||{};
    var back=document.createElement('div'); back.className='tx-dback';
    var dr=document.createElement('div'); dr.className='tx-drawer'; if(opts.width) dr.style.width=opts.width;
    var h=document.createElement('div'); h.className='tx-dhead';
    h.innerHTML='<div><div class="tx-dtitle">'+(opts.title||'')+'</div>'+(opts.subtitle?'<div class="tx-dsub">'+opts.subtitle+'</div>':'')+'</div><button class="tx-x" aria-label="닫기">✕</button>';
    var b=document.createElement('div'); b.className='tx-dbody';
    if(typeof opts.body==='string') b.innerHTML=opts.body; else if(opts.body) b.appendChild(opts.body);
    dr.appendChild(h); dr.appendChild(b); back.appendChild(dr); root().appendChild(back);
    function close(){ back.classList.remove('show'); setTimeout(function(){ back.remove(); },240); }
    h.querySelector('.tx-x').addEventListener('click',close);
    back.addEventListener('click',function(e){ if(e.target===back) close(); });
    document.addEventListener('keydown',function esc(e){ if(e.key==='Escape'){ close(); document.removeEventListener('keydown',esc);} });
    requestAnimationFrame(function(){ back.classList.add('show'); });
    return { el:dr, close:close, body:b };
  };

  /* ---- contextual menu near an anchor. items:[{label,onClick,danger}] ---- */
  TX.menu = function(anchor, items){
    var m=document.createElement('div'); m.className='tx-menu';
    items.forEach(function(it){
      if(it.sep){ var s=document.createElement('div'); s.className='tx-msep'; m.appendChild(s); return; }
      var el=document.createElement('button'); el.className='tx-mitem'+(it.danger?' tx-danger':''); el.textContent=it.label;
      el.addEventListener('click',function(){ close(); it.onClick&&it.onClick(); }); m.appendChild(el);
    });
    root().appendChild(m);
    var r=anchor.getBoundingClientRect();
    var top=r.bottom+6, left=Math.min(r.left, window.innerWidth-m.offsetWidth-12);
    if(top+m.offsetHeight>window.innerHeight-10) top=r.top-m.offsetHeight-6;
    m.style.top=top+'px'; m.style.left=Math.max(8,left)+'px';
    function close(){ m.remove(); document.removeEventListener('mousedown',out,true); }
    function out(e){ if(!m.contains(e.target)) close(); }
    setTimeout(function(){ document.addEventListener('mousedown',out,true); },0);
    requestAnimationFrame(function(){ m.classList.add('show'); });
    return { close:close };
  };

  /* ---- small form-field builder for modals ---- */
  TX.field = function(label, inner){ return '<label class="tx-field"><span>'+label+'</span>'+inner+'</label>'; };
  TX.esc = function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
})();
