// Shared by the transaction form and the Bills page: turns a picked photo
// or PDF into the JPEG data URL that POST /api/scan/receipt expects.

// Phone photos are often 4000px+ and several MB. Receipt and bill text
// stays readable at 1600px (~145 dpi for a letter-size PDF page), and the
// smaller image uploads faster and fits the model's default context
// window, so shrink it in the browser before sending. Going bigger makes
// the request overflow that window - see the note in backend/routes/scan.js.
const SCAN_MAX_SIDE = 1600;

// What the file pickers accept - matches what the scan route can read.
export const SCAN_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';

async function imageFileToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, SCAN_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

// Bills usually arrive as emailed PDFs. Render page 1 (where the amount
// due and due date live) to an image so the same scan route handles it.
// pdf.js is large, so it's only loaded the first time someone picks a PDF.
async function pdfFileToDataUrl(file) {
  const [pdfjs, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  try {
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: SCAN_MAX_SIDE / Math.max(base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; // PDFs can have a transparent background
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    return canvas.toDataURL('image/jpeg', 0.85);
  } finally {
    pdf.destroy();
  }
}

export function scanFileToDataUrl(file) {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  return isPdf ? pdfFileToDataUrl(file) : imageFileToDataUrl(file);
}
