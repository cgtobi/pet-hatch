import qrcode from 'qrcode-generator';

/** A QR code for this text as an SVG, one path of dark squares with a quiet zone, scaling to its box. */
export function qrSvg(text: string, label: string): string {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const quiet = 3;
  let path = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c + quiet} ${r + quiet}h1v1h-1z`;
  }
  const size = n + 2 * quiet;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${label.replace(/"/g, '&quot;')}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#2e2a3a"/></svg>`;
}
