// Subject-agnostic reader rendering (Constitution VII): turns a `ReaderModel`
// (pure data -- see `@/reader/discover.ts`) into ONE self-contained,
// mobile-first HTML document. No subject strings, project names, or story
// names appear anywhere below -- every piece of copy that names content
// (titles, labels, registers, bodies) comes from `model`/`opts`. The visual
// language (toned archival paper, ink-blue accent, native reading serifs,
// mono citation tags, sticky header + horizontally-scrollable chip rows,
// theme toggle, tiny markdown renderer, light+dark CSS tokens, reduced
// motion) is carried over from the working single-chapter reference reader,
// generalized here to be data-driven and multi-chapter.
//
// CSP-safe: no external URLs of any kind -- CSS and JS are inlined, and the
// model is embedded as a JSON data island with every `<` escaped to
// `<` so a body's content (or any other model field) can never break
// out of the `<script type="application/json">` element.

import type { ReaderModel } from '@/reader/discover.ts';

export interface RenderReaderOpts {
  title: string;
}

export function renderReader(model: ReaderModel, opts: RenderReaderOpts): string {
  const title = escapeHtml(opts.title);
  const dataJson = JSON.stringify(model).replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${CSS}</style>
</head>
<body>
<div class="topbar">
  <div class="masthead">
    <div class="kicker">${title}</div>
    <button class="themebtn" id="theme" type="button" aria-label="Toggle light or dark">Theme</button>
  </div>
  <div class="chips" id="chapter-chips" role="tablist" aria-label="Chapter"></div>
  <div class="chips" id="voice-chips" role="tablist" aria-label="Voice"></div>
</div>

<main>
  <div class="voicehead">
    <p class="voicename" id="vname"></p>
    <p class="register" id="vreg"></p>
    <span class="provenance"><span class="dot"></span><span id="vprov"></span></span>
  </div>
  <article id="reader" aria-live="polite"></article>
</main>

<footer>
  <b>Machine-produced voice editions.</b> Each edition re-narrates a
  human-authored source under an explicit voice, gated by a deterministic
  fidelity check: every quoted passage, citation, and figure is preserved
  <b>verbatim</b> -- only the narration around them is revised. The
  canonical text is the original source; these editions are studies, not
  replacements.
</footer>

<script type="application/json" id="reader-data">${dataJson}</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CSS = `
  :root{
    --paper:#e6e3da; --panel:#efece3; --ink:#23252b; --muted:#5b5d64; --faint:#8b8c88;
    --hairline:#cdc9bc; --accent:#33506e; --accent-soft:#33506e26; --evidence:#33506e;
    --serif:"Iowan Old Style","New York","Palatino Linotype",Palatino,Georgia,"Times New Roman",serif;
    --sans:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    --mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    --measure:34rem;
  }
  @media (prefers-color-scheme:dark){
    :root{ --paper:#191a1d; --panel:#212327; --ink:#e4e2d9; --muted:#a0a099; --faint:#75766f;
      --hairline:#34353b; --accent:#84a9d0; --accent-soft:#84a9d024; --evidence:#84a9d0; }
  }
  :root[data-theme="light"]{ --paper:#e6e3da; --panel:#efece3; --ink:#23252b; --muted:#5b5d64; --faint:#8b8c88;
    --hairline:#cdc9bc; --accent:#33506e; --accent-soft:#33506e26; --evidence:#33506e; }
  :root[data-theme="dark"]{ --paper:#191a1d; --panel:#212327; --ink:#e4e2d9; --muted:#a0a099; --faint:#75766f;
    --hairline:#34353b; --accent:#84a9d0; --accent-soft:#84a9d024; --evidence:#84a9d0; }

  *{box-sizing:border-box}
  body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--serif);
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;}

  .topbar{position:sticky;top:0;z-index:5;background:color-mix(in srgb,var(--paper) 92%,transparent);
    backdrop-filter:saturate(1.1) blur(8px);border-bottom:1px solid var(--hairline);}
  .masthead{max-width:var(--measure);margin:0 auto;padding:.7rem 1.15rem .55rem;
    display:flex;align-items:baseline;justify-content:space-between;gap:1rem;}
  .kicker{font-family:var(--sans);font-size:.66rem;letter-spacing:.16em;text-transform:uppercase;
    color:var(--muted);font-weight:600;}
  .themebtn{font-family:var(--sans);font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;
    color:var(--muted);background:none;border:1px solid var(--hairline);border-radius:999px;
    padding:.28rem .6rem;cursor:pointer;}
  .themebtn:hover{color:var(--ink);border-color:var(--accent)}

  .chips{display:flex;gap:.4rem;overflow-x:auto;scroll-snap-type:x proximity;
    padding:.15rem 1.15rem .6rem;-webkit-overflow-scrolling:touch;scrollbar-width:none;}
  .chips:empty{display:none}
  .chips::-webkit-scrollbar{display:none}
  .chip{scroll-snap-align:start;flex:0 0 auto;font-family:var(--sans);font-size:.8rem;
    color:var(--muted);background:var(--panel);border:1px solid var(--hairline);border-radius:999px;
    padding:.4rem .8rem;cursor:pointer;white-space:nowrap;transition:color .15s,border-color .15s,background .15s;}
  .chip:hover{color:var(--ink)}
  .chip[aria-selected="true"]{color:var(--paper);background:var(--accent);border-color:var(--accent);}
  .chip[aria-selected="true"]{color:#f4f2ea}
  @media (prefers-color-scheme:dark){ .chip[aria-selected="true"]{color:#16171a} }
  :root[data-theme="light"] .chip[aria-selected="true"]{color:#f4f2ea}
  :root[data-theme="dark"] .chip[aria-selected="true"]{color:#16171a}
  .chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}

  main{max-width:var(--measure);margin:0 auto;padding:1.9rem 1.15rem 5rem;}
  .voicehead{border-bottom:1px solid var(--hairline);padding-bottom:1.15rem;margin-bottom:1.6rem;}
  .voicename{font-family:var(--sans);font-weight:650;font-size:.72rem;letter-spacing:.15em;
    text-transform:uppercase;color:var(--accent);margin:0 0 .5rem;}
  .register{font-family:var(--serif);font-style:italic;font-size:1.02rem;line-height:1.5;
    color:var(--muted);margin:0 0 .8rem;max-width:30rem;}
  .provenance{display:inline-flex;align-items:center;gap:.45rem;font-family:var(--mono);
    font-size:.66rem;color:var(--faint);}
  .dot{width:.4rem;height:.4rem;border-radius:50%;background:var(--accent);display:inline-block}

  article{font-size:1.185rem;line-height:1.63;}
  article h1{font-weight:650;font-size:1.92rem;line-height:1.16;letter-spacing:-.01em;
    text-wrap:balance;margin:.2rem 0 1.3rem;}
  article h2{font-family:var(--sans);font-weight:600;font-size:.74rem;letter-spacing:.13em;
    text-transform:uppercase;color:var(--muted);margin:2.5rem 0 .1rem;
    padding-top:1.1rem;border-top:1px solid var(--hairline);}
  article p{margin:1.05rem 0;}
  article p:first-of-type{margin-top:0}
  article > p.lead::first-letter{font-size:3.2rem;line-height:.8;float:left;
    padding:.3rem .5rem 0 0;color:var(--accent);font-weight:600;}
  blockquote{margin:1.5rem 0;padding:.15rem 0 .15rem 1.3rem;border-left:2px solid var(--evidence);
    color:var(--ink);font-size:1.06rem;line-height:1.55;}
  blockquote p{margin:.4rem 0}
  cite.src{font-family:var(--mono);font-style:normal;font-size:.72em;letter-spacing:.02em;
    color:var(--accent);background:var(--accent-soft);border-radius:4px;padding:.05em .34em;
    white-space:nowrap;vertical-align:.08em;margin-left:.15em;}

  footer{max-width:var(--measure);margin:0 auto;padding:1.4rem 1.15rem 3rem;
    border-top:1px solid var(--hairline);font-family:var(--sans);font-size:.78rem;line-height:1.55;color:var(--muted);}
  footer b{color:var(--ink);font-weight:600}

  .fade{animation:fade .28s ease}
  @keyframes fade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  @media (prefers-reduced-motion:reduce){ .fade{animation:none} * {scroll-behavior:auto} }
`;

const CLIENT_JS = `
(function(){
  var model = JSON.parse(document.getElementById('reader-data').textContent);
  var chapters = model.chapters;
  var voices = model.voices;

  var esc = function(s){return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');};
  var CITE = /\\[(?:\\^[^\\]\\s]+|[A-Z][A-Z0-9]*-[A-Z0-9-]+)\\]/g;
  function inline(s){
    return esc(s).replace(CITE, function(m){ return '<cite class="src">'+m+'</cite>'; });
  }
  function render(md){
    var blocks = md.replace(/\\r\\n/g,'\\n').split(/\\n{2,}/);
    var html = '', firstPara = true;
    for(var i=0;i<blocks.length;i++){
      var b = blocks[i].trim();
      if(!b) continue;
      if(b.indexOf('# ')===0 && b.indexOf('## ')!==0){ html += '<h1>'+inline(b.slice(2).trim())+'</h1>'; continue; }
      if(b.indexOf('## ')===0){ html += '<h2>'+inline(b.slice(3).trim())+'</h2>'; continue; }
      if(b.indexOf('>')===0){
        var inner = b.split('\\n').map(function(l){return l.replace(/^\\s*>\\s?/,'');}).join(' ').trim();
        html += '<blockquote><p>'+inline(inner)+'</p></blockquote>'; continue;
      }
      var cls = firstPara ? ' class="lead"' : '';
      firstPara = false;
      html += '<p'+cls+'>'+inline(b.replace(/\\n/g,' '))+'</p>';
    }
    return html;
  }

  function provenanceLine(summary){
    var parts = [summary.units + ' units'];
    ['verbatim','represented','merged','cut'].forEach(function(op){
      if(summary[op] > 0){ parts.push(summary[op] + ' ' + op); }
    });
    return 'machine-produced \\u00b7 ' + parts.join(' \\u00b7 ');
  }

  var chapterChips = document.getElementById('chapter-chips');
  var voiceChips = document.getElementById('voice-chips');
  var reader = document.getElementById('reader');
  var vname = document.getElementById('vname'), vreg = document.getElementById('vreg'), vprov = document.getElementById('vprov');

  var state = { chapterIndex: 0, voiceSlug: chapters[0].editions[0].voiceSlug };

  function findEdition(chapterIndex, voiceSlug){
    var chapter = chapters[chapterIndex];
    for(var i=0;i<chapter.editions.length;i++){
      if(chapter.editions[i].voiceSlug === voiceSlug){ return chapter.editions[i]; }
    }
    return chapter.editions[0];
  }

  function show(chapterIndex, voiceSlug){
    var edition = findEdition(chapterIndex, voiceSlug);
    state.chapterIndex = chapterIndex;
    state.voiceSlug = edition.voiceSlug;

    vname.textContent = edition.label;
    vreg.textContent = edition.register;
    vprov.textContent = provenanceLine(edition.summary);
    reader.innerHTML = render(edition.body);
    reader.classList.remove('fade'); void reader.offsetWidth; reader.classList.add('fade');

    Array.prototype.forEach.call(chapterChips.children, function(c,j){
      c.setAttribute('aria-selected', j===chapterIndex ? 'true' : 'false');
    });
    Array.prototype.forEach.call(voiceChips.children, function(c){
      c.setAttribute('aria-selected', c.dataset.slug===edition.voiceSlug ? 'true' : 'false');
    });
    window.scrollTo({top:0, behavior:'smooth'});
  }

  if(chapters.length > 1){
    chapters.forEach(function(chapter, i){
      var b = document.createElement('button');
      b.className='chip'; b.type='button'; b.setAttribute('role','tab');
      b.textContent = chapter.title;
      b.addEventListener('click', function(){ show(i, state.voiceSlug); b.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'}); });
      chapterChips.appendChild(b);
    });
  }

  voices.forEach(function(voice){
    var b = document.createElement('button');
    b.className='chip'; b.type='button'; b.setAttribute('role','tab'); b.dataset.slug = voice.slug;
    b.textContent = voice.label;
    b.addEventListener('click', function(){ show(state.chapterIndex, voice.slug); b.scrollIntoView({inline:'center',block:'nearest',behavior:'smooth'}); });
    voiceChips.appendChild(b);
  });

  var root = document.documentElement, tb = document.getElementById('theme');
  tb.addEventListener('click', function(){
    var cur = root.getAttribute('data-theme');
    if(!cur){ cur = matchMedia('(prefers-color-scheme:dark)').matches ? 'dark':'light'; }
    root.setAttribute('data-theme', cur==='dark'?'light':'dark');
  });

  show(0, state.voiceSlug);
})();
`;
