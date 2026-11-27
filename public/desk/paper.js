// The original paper inside the desk. A pdf is drawn page by page with pdf.js, which the desk serves itself
// (nothing is fetched from outside), so the shipping papers look the same on a laptop, an iPad or an Android
// phone, where a pdf in a frame stays empty. A photo is just shown. If drawing fails, the browser's own viewer takes over.
import { h } from './core.js';

let lib = null;
const load = () => (lib ||= import('/desk/vendor/pdf.mjs').catch(e => { lib = null; throw e; }));

export function paperHtml(id, title, mime = '') {
  const url = `/api/bestanden/${Number(id)}`;
  if (String(mime).startsWith('image/')) return `<div class="paper"><img src="${url}" alt="${h(title)}"></div>`;
  return `<div class="paper" data-pdf="${url}" data-title="${h(title)}"><p class="paper-wait">Het origineel laden…</p></div>`;
}

export function drawPapers(root = document) {
  for (const box of root.querySelectorAll('.paper[data-pdf]:not([data-busy])')) draw(box);
}

const MAX_PAGES = 8;

async function draw(box) {
  box.dataset.busy = '1';
  const url = box.dataset.pdf, title = box.dataset.title || 'Origineel';
  try {
    const [pdfjs, buf] = await Promise.all([
      load(),
      fetch(url, { credentials: 'same-origin' }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); }),
    ]);
    const task = pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }), doc = await task.promise;
    const n = Math.min(doc.numPages, MAX_PAGES), ratio = Math.min(window.devicePixelRatio || 1, 2), width = box.clientWidth || 640;
    const pages = [];
    for (let i = 1; i <= n && box.isConnected; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: (width / page.getViewport({ scale: 1 }).width) * ratio });
      const c = document.createElement('canvas');
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', `${title}, pagina ${i} van ${doc.numPages}`);
      await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise;
      pages.push(c);
    }
    if (box.isConnected) {
      box.replaceChildren(...pages);
      if (doc.numPages > n) box.insertAdjacentHTML('beforeend', `<p class="paper-more">Nog ${doc.numPages - n} pagina's in het origineel.</p>`);
      box.classList.add('is-drawn');
    }
    Promise.resolve().then(() => task.destroy?.()).catch(() => {});
  } catch (e) {
    console.warn('Het origineel tekenen lukte niet, de pdf-viewer van de browser neemt het over.', e);
    if (box.isConnected) box.innerHTML = `<iframe src="${h(url)}#view=FitH" title="${h(title)}"></iframe>`;
  }
}
