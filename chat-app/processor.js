// ─── Document Processor ───────────────────────────────────────────────────────
// Handles PDF, Word, Excel, PowerPoint file processing

const Processor = (() => {

  function chunkText(text, chunkSize = 450, overlap = 60) {
    const words = text.split(/\s+/).filter(w => w.length > 0);
    const chunks = [];
    let i = 0;
    while (i < words.length) {
      const slice = words.slice(i, i + chunkSize).join(' ');
      if (slice.trim()) chunks.push(slice);
      i += chunkSize - overlap;
    }
    return chunks;
  }

  // ── PDF ───────────────────────────────────────────────────────────────────
  async function processPDF(file) {
    if (!window['pdfjs-dist/build/pdf']) throw new Error('PDF.js not loaded');
    const pdfjsLib = window['pdfjs-dist/build/pdf'];
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    const chunks = [];
    const images = [];

    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);

      // Extract text
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ').trim();
      if (pageText) {
        const pageChunks = chunkText(pageText);
        pageChunks.forEach(c => chunks.push({ text: c, page: p }));
      }

      // Render page as image
      const viewport = page.getViewport({ scale: 1.2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      images.push({ dataUrl: canvas.toDataURL('image/jpeg', 0.7), page: p, label: `صفحة ${p}` });
    }

    return { chunks, images };
  }

  // ── Word (.docx) ──────────────────────────────────────────────────────────
  async function processWord(file) {
    if (!window.mammoth) throw new Error('Mammoth.js not loaded');
    const arrayBuffer = await file.arrayBuffer();
    const result = await mammoth.extractRawText({ arrayBuffer });
    const chunks = chunkText(result.value).map(c => ({ text: c, page: null }));
    return { chunks, images: [] };
  }

  // ── Excel (.xlsx / .xls / .csv) ───────────────────────────────────────────
  async function processExcel(file) {
    if (!window.XLSX) throw new Error('SheetJS not loaded');
    const arrayBuffer = await file.arrayBuffer();
    const workbook = XLSX.read(arrayBuffer, { type: 'array' });
    let allText = '';
    workbook.SheetNames.forEach(name => {
      const sheet = workbook.Sheets[name];
      allText += `[ورقة: ${name}]\n` + XLSX.utils.sheet_to_csv(sheet) + '\n\n';
    });
    const chunks = chunkText(allText).map(c => ({ text: c, page: null }));
    return { chunks, images: [] };
  }

  // ── PowerPoint (.pptx) ────────────────────────────────────────────────────
  async function processPPTX(file) {
    if (!window.JSZip) throw new Error('JSZip not loaded');
    const arrayBuffer = await file.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    const slideFiles = Object.keys(zip.files)
      .filter(f => /^ppt\/slides\/slide\d+\.xml$/i.test(f))
      .sort((a, b) => {
        const na = parseInt(a.match(/\d+/)[0]);
        const nb = parseInt(b.match(/\d+/)[0]);
        return na - nb;
      });

    const chunks = [];
    for (let i = 0; i < slideFiles.length; i++) {
      const xmlStr = await zip.files[slideFiles[i]].async('string');
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlStr, 'text/xml');
      const textNodes = xmlDoc.querySelectorAll('t');
      const slideText = Array.from(textNodes)
        .map(t => t.textContent)
        .join(' ')
        .trim();
      if (slideText) {
        const slideChunks = chunkText(slideText);
        slideChunks.forEach(c => chunks.push({ text: c, page: i + 1 }));
      }
    }

    return { chunks, images: [] };
  }

  // ── Main Dispatcher ───────────────────────────────────────────────────────
  async function processFile(file) {
    const name = file.name.toLowerCase();
    const ext = name.split('.').pop();

    if (ext === 'pdf') return processPDF(file);
    if (ext === 'docx' || ext === 'doc') return processWord(file);
    if (['xlsx', 'xls', 'csv'].includes(ext)) return processExcel(file);
    if (ext === 'pptx' || ext === 'ppt') return processPPTX(file);
    if (['txt', 'md', 'json', 'html'].includes(ext)) {
      const text = await file.text();
      return { chunks: chunkText(text).map(c => ({ text: c, page: null })), images: [] };
    }

    throw new Error(`نوع الملف غير مدعوم: .${ext}`);
  }

  // ── RAG Retrieval ─────────────────────────────────────────────────────────
  function scoreChunk(query, chunkText) {
    const qTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const cLower = chunkText.toLowerCase();
    let score = 0;
    qTerms.forEach(term => {
      const matches = (cLower.match(new RegExp(term, 'g')) || []).length;
      score += matches;
    });
    return score;
  }

  function getRelevantChunks(query, references, topK = 4) {
    const scored = [];
    references.forEach(ref => {
      if (!ref.enabled || !ref.chunks) return;
      ref.chunks.forEach((chunk, idx) => {
        const s = scoreChunk(query, chunk.text);
        if (s > 0) {
          scored.push({ text: chunk.text, page: chunk.page, sourceName: ref.name, score: s, idx });
        }
      });
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  function getRelevantImages(query, references, maxImages = 3) {
    const imgs = [];
    references.forEach(ref => {
      if (!ref.enabled || !ref.images) return;
      ref.images.forEach(img => imgs.push({ ...img, sourceName: ref.name }));
    });
    return imgs.slice(0, maxImages);
  }

  return { processFile, getRelevantChunks, getRelevantImages };
})();
