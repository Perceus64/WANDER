// DOM overlay used by the runtime (no framework: published builds stay small).
const CSS = `
.wr-root{position:absolute;inset:0;overflow:hidden;background:#000;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#f1f1ee;user-select:none}
.wr-root canvas{display:block;width:100%;height:100%}
.wr-root *{box-sizing:border-box}
.wr-cross{position:absolute;left:50%;top:50%;width:6px;height:6px;margin:-3px;border-radius:50%;background:rgba(255,255,255,.8);box-shadow:0 0 0 1px rgba(0,0,0,.4);pointer-events:none}
.wr-prompt{position:absolute;left:50%;bottom:22%;transform:translateX(-50%);padding:8px 14px;background:rgba(15,17,20,.78);border:1px solid rgba(255,255,255,.18);border-radius:8px;font-size:15px;pointer-events:none;white-space:nowrap}
.wr-prompt b{display:inline-block;min-width:22px;padding:1px 6px;margin-right:8px;border-radius:5px;background:#e8a33d;color:#16181c;text-align:center}
.wr-toasts{position:absolute;right:18px;top:18px;display:flex;flex-direction:column;gap:8px;align-items:flex-end;pointer-events:none}
.wr-toast{padding:10px 14px;background:rgba(15,17,20,.82);border-left:3px solid #e8a33d;border-radius:6px;font-size:14px;max-width:340px;animation:wr-in .25s ease}
.wr-objective{position:absolute;left:18px;top:18px;padding:8px 12px;background:rgba(15,17,20,.7);border-radius:6px;font-size:14px;max-width:320px;pointer-events:none}
.wr-objective small{display:block;opacity:.6;font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.wr-sub{position:absolute;left:50%;bottom:9%;transform:translateX(-50%);max-width:70%;padding:6px 14px;background:rgba(0,0,0,.6);border-radius:4px;font-size:19px;text-align:center;pointer-events:none}
.wr-dialogue{position:absolute;left:50%;bottom:5%;transform:translateX(-50%);width:min(720px,88%);padding:16px 20px;background:rgba(15,17,20,.9);border:1px solid rgba(255,255,255,.14);border-radius:10px;font-size:17px;line-height:1.45;pointer-events:none}
.wr-dialogue b{display:block;color:#e8a33d;font-size:13px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px}
.wr-info{position:absolute;right:24px;top:50%;transform:translateY(-50%);width:min(400px,86%);max-height:80%;overflow:auto;padding:20px 22px;border-radius:12px;border-top:4px solid #e8a33d;box-shadow:0 18px 50px rgba(0,0,0,.5);font-size:15px;line-height:1.5;animation:wr-in .3s ease}
.wr-info.wr-slide{animation:wr-slide .35s ease}
.wr-info.serif{font-family:Georgia,"Times New Roman",serif}
.wr-info.mono{font-family:ui-monospace,Menlo,Consolas,monospace}
.wr-info h2{margin:0 0 10px;font-size:21px;line-height:1.2}
.wr-info p{margin:0 0 10px}
.wr-info img,.wr-info video{width:100%;border-radius:8px;margin:4px 0 12px;display:block}
.wr-info audio{width:100%;margin-bottom:10px}
.wr-info a{color:inherit;font-weight:600}
.wr-info .wr-tag{font-size:11px;letter-spacing:.1em;text-transform:uppercase;opacity:.65;margin-bottom:6px}
.wr-info .wr-hint{font-size:12px;opacity:.6;margin-top:8px}
.wr-info.focus{left:50%;right:auto;transform:translate(-50%,-50%);width:min(560px,90%)}
.wr-btn{appearance:none;border:0;padding:9px 16px;border-radius:7px;background:#e8a33d;color:#16181c;font:600 14px system-ui,sans-serif;cursor:pointer}
.wr-btn.ghost{background:rgba(255,255,255,.12);color:#fff}
.wr-fade{position:absolute;inset:0;background:#000;opacity:0;pointer-events:none}
.wr-bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height .5s ease;pointer-events:none}
.wr-bar.t{top:0}.wr-bar.b{bottom:0}
.wr-root.cine .wr-bar{height:11%}
.wr-root.cine .wr-cross,.wr-root.cine .wr-prompt,.wr-root.cine .wr-objective{display:none}
.wr-title{position:absolute;left:0;right:0;top:40%;text-align:center;font-size:44px;font-weight:300;letter-spacing:.14em;text-shadow:0 2px 18px rgba(0,0,0,.7);pointer-events:none;transition:opacity 1.2s ease}
.wr-overlay{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:rgba(8,9,11,.72);backdrop-filter:blur(3px);text-align:center;padding:24px}
.wr-overlay h1{margin:0;font-size:40px;font-weight:300;letter-spacing:.1em}
.wr-overlay p{margin:0;opacity:.75;max-width:520px;line-height:1.5}
.wr-overlay .wr-keys{font-size:13px;opacity:.6}
.wr-overlay .wr-row{display:flex;gap:10px}
.wr-load{width:220px;height:3px;background:rgba(255,255,255,.15);border-radius:2px;overflow:hidden}
.wr-load i{display:block;height:100%;width:30%;background:#e8a33d;animation:wr-load 1.1s linear infinite}
.wr-elev{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);padding:18px;background:rgba(20,23,28,.95);border:1px solid rgba(255,255,255,.16);border-radius:12px;display:flex;flex-direction:column-reverse;gap:8px;min-width:180px}
.wr-elev h3{order:99;margin:0 0 6px;font-size:13px;letter-spacing:.1em;text-transform:uppercase;opacity:.7;text-align:center}
.wr-elev button{appearance:none;border:1px solid rgba(255,255,255,.2);background:#262b33;color:#fff;border-radius:8px;padding:10px 14px;font:600 15px system-ui;cursor:pointer}
.wr-elev button.cur{border-color:#e8a33d;color:#e8a33d}
.wr-journal{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(560px,90%);max-height:76%;overflow:auto;padding:22px;background:#f1ead9;color:#2a2620;border-radius:6px;font-family:Georgia,serif;box-shadow:0 18px 50px rgba(0,0,0,.6)}
.wr-journal h2{margin:0 0 12px}.wr-journal h4{margin:14px 0 2px}.wr-journal p{margin:0;opacity:.8;font-size:14px;line-height:1.5}
.wr-hide{display:none!important}
@keyframes wr-in{from{opacity:0}to{opacity:1}}
@keyframes wr-slide{from{opacity:0;right:-60px}to{opacity:1}}
@keyframes wr-load{from{margin-left:-30%}to{margin-left:100%}}
.wr-toast{animation-name:wr-toast}@keyframes wr-toast{from{opacity:0;transform:translateX(12px)}to{opacity:1}}
`;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}

/** Tiny safe formatter: blank lines split paragraphs, **bold** and *italic*. Never uses innerHTML. */
export function richText(parent: HTMLElement, text: string) {
  for (const para of String(text ?? '').split(/\n+/)) {
    if (!para.trim()) continue;
    const p = el('p', '', parent);
    for (const tok of para.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/)) {
      if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) el('strong', '', p, tok.slice(2, -2));
      else if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) el('em', '', p, tok.slice(1, -1));
      else if (tok) p.appendChild(document.createTextNode(tok));
    }
  }
}

export class Hud {
  root: HTMLDivElement;
  cross: HTMLElement; prompt: HTMLElement; toasts: HTMLElement; objective: HTMLElement; sub: HTMLElement;
  dialogue: HTMLElement; info: HTMLElement; fade: HTMLElement; title: HTMLElement; overlay: HTMLElement; elev: HTMLElement; journal: HTMLElement;
  private timers = new Map<HTMLElement, number>();

  constructor(container: HTMLElement) {
    if (!document.getElementById('wr-css')) {
      const s = el('style', '');
      s.id = 'wr-css';
      s.textContent = CSS;
      document.head.appendChild(s);
    }
    this.root = el('div', 'wr-root', container);
    this.fade = el('div', 'wr-fade', this.root);
    el('div', 'wr-bar t', this.root);
    el('div', 'wr-bar b', this.root);
    this.cross = el('div', 'wr-cross', this.root);
    this.prompt = el('div', 'wr-prompt wr-hide', this.root);
    this.toasts = el('div', 'wr-toasts', this.root);
    this.objective = el('div', 'wr-objective wr-hide', this.root);
    this.sub = el('div', 'wr-sub wr-hide', this.root);
    this.dialogue = el('div', 'wr-dialogue wr-hide', this.root);
    this.title = el('div', 'wr-title', this.root);
    this.title.style.opacity = '0';
    this.info = el('div', 'wr-info wr-hide', this.root);
    this.elev = el('div', 'wr-elev wr-hide', this.root);
    this.journal = el('div', 'wr-journal wr-hide', this.root);
    this.overlay = el('div', 'wr-overlay', this.root);
  }

  show(e: HTMLElement, on: boolean) { e.classList.toggle('wr-hide', !on); }
  visible(e: HTMLElement) { return !e.classList.contains('wr-hide'); }

  /** Show an element for `seconds`, then hide it. */
  timed(e: HTMLElement, seconds: number) {
    this.show(e, true);
    clearTimeout(this.timers.get(e));
    if (seconds > 0) this.timers.set(e, window.setTimeout(() => this.show(e, false), seconds * 1000));
  }

  setPrompt(key: string | null, label = '') {
    if (!key) return this.show(this.prompt, false);
    if (this.prompt.dataset.k !== key + label) {
      this.prompt.dataset.k = key + label;
      this.prompt.textContent = '';
      el('b', '', this.prompt, key);
      this.prompt.appendChild(document.createTextNode(label));
    }
    this.show(this.prompt, true);
  }

  toast(text: string, seconds = 4) {
    const t = el('div', 'wr-toast', this.toasts, text);
    setTimeout(() => t.remove(), seconds * 1000);
  }

  setObjective(text: string) {
    this.objective.textContent = '';
    if (!text) return this.show(this.objective, false);
    el('small', '', this.objective, 'Objective');
    this.objective.appendChild(document.createTextNode(text));
    this.show(this.objective, true);
  }

  subtitle(text: string, seconds = 0) {
    if (!text) return this.show(this.sub, false);
    this.sub.textContent = text;
    this.timed(this.sub, seconds);
  }

  say(speaker: string, text: string, seconds: number) {
    this.dialogue.textContent = '';
    if (speaker) el('b', '', this.dialogue, speaker);
    this.dialogue.appendChild(document.createTextNode(text));
    this.timed(this.dialogue, seconds);
  }

  showTitle(text: string, seconds = 4) {
    this.title.textContent = text;
    this.title.style.opacity = text ? '1' : '0';
    if (text) setTimeout(() => (this.title.style.opacity = '0'), seconds * 1000);
  }

  overlayScreen(build: (o: HTMLElement) => void) {
    this.overlay.textContent = '';
    build(this.overlay);
    this.show(this.overlay, true);
  }

  dispose() { this.timers.forEach((t) => clearTimeout(t)); this.root.remove(); }
}
