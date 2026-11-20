/**
 * Archivo: src/lib/receiptRenderer.ts
 * Responsabilidad: Generación determinista de recibos internos no fiscales en formatos
 *   Imagen PNG (Canvas 2D de alta resolución) y PDF (jsPDF) a partir de los mismos datos
 *   persistidos del recibo correlativo, sin re-emitir ni consumir numeración al descargar.
 * Cumplimiento LuchoRentas.md: RF-036 (CA-036: ambos formatos muestran los mismos datos y
 *   numeración), §4.6 (leyenda visible de comprobante interno no fiscal), DEC-12 y America/La_Paz.
 */
import { jsPDF } from 'jspdf';
import { buildReceiptDisplayPayload } from './phase4Domain';
import type { RentReceipt } from '../types/domain';

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['—'];
  const lines: string[] = [];
  let current = words[0];
  for (let i = 1; i < words.length; i += 1) {
    const candidate = `${current} ${words[i]}`;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      lines.push(current);
      current = words[i];
    }
  }
  lines.push(current);
  return lines;
}

/**
 * Descarga el recibo emitido como imagen PNG nítida usando Canvas 2D nativo.
 */
export function downloadReceiptAsPng(receipt: RentReceipt): void {
  const payload = buildReceiptDisplayPayload(receipt);
  const width = 1080;
  const height = 1320;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Fondo blanco documento oficial
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);

  // Marco exterior limpio
  ctx.strokeStyle = '#CBD5E1';
  ctx.lineWidth = 3;
  ctx.strokeRect(48, 48, width - 96, height - 96);

  // Franja superior acento
  ctx.fillStyle = receipt.status === 'voided_by_reversal' ? '#B91C1C' : '#059669';
  ctx.fillRect(48, 48, width - 96, 14);

  // Encabezado
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText(payload.tenantName, 88, 128);

  ctx.fillStyle = '#475569';
  ctx.font = '600 20px sans-serif';
  ctx.fillText('RECIBO DE COBRO DE ALQUILER', 88, 166);

  // Número correlativo a la derecha
  ctx.textAlign = 'right';
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 34px monospace';
  ctx.fillText(payload.receiptNumber, width - 88, 128);

  ctx.fillStyle = receipt.status === 'voided_by_reversal' ? '#DC2626' : '#047857';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(payload.statusLabel, width - 88, 166);
  ctx.textAlign = 'left';

  // Línea divisoria
  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(88, 200);
  ctx.lineTo(width - 88, 200);
  ctx.stroke();

  // Bloque importe destacado
  ctx.fillStyle = '#F8FAFC';
  ctx.fillRect(88, 232, width - 176, 130);
  ctx.strokeStyle = '#E2E8F0';
  ctx.strokeRect(88, 232, width - 176, 130);

  ctx.fillStyle = '#64748B';
  ctx.font = '600 20px sans-serif';
  ctx.fillText(`IMPORTE RECIBIDO (${payload.currency})`, 118, 276);

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 46px monospace';
  ctx.fillText(payload.formattedAmount, 118, 336);

  // Filas de detalle idénticas al PDF desde payload compartido
  let y = 420;
  for (const row of payload.rows) {
    ctx.fillStyle = '#64748B';
    ctx.font = '600 20px sans-serif';
    ctx.fillText(row.label, 88, y);

    ctx.fillStyle = '#0F172A';
    ctx.font = '500 23px sans-serif';
    const lines = wrapTextLines(ctx, row.value, width - 176);
    lines.slice(0, 2).forEach((line, idx) => {
      ctx.fillText(line, 88, y + 32 + idx * 30);
    });

    const rowHeight = lines.length > 1 ? 94 : 74;
    ctx.strokeStyle = '#F1F5F9';
    ctx.beginPath();
    ctx.moveTo(88, y + rowHeight - 16);
    ctx.lineTo(width - 88, y + rowHeight - 16);
    ctx.stroke();

    y += rowHeight;
  }

  // Leyenda obligatoria no fiscal (§4.6 / DEC-12)
  ctx.fillStyle = '#F1F5F9';
  ctx.fillRect(88, height - 180, width - 176, 86);
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'center';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(payload.nonFiscalLegend, width / 2, height - 134);
  ctx.font = '400 17px sans-serif';
  ctx.fillStyle = '#64748B';
  ctx.fillText(
    'Documento emitido transaccionalmente · El re-descargado conserva la misma numeración',
    width / 2,
    height - 106
  );

  const link = document.createElement('a');
  link.download = `recibo-${payload.receiptNumber}.png`;
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/**
 * Descarga el recibo emitido como documento PDF vectorial usando jsPDF.
 */
export function downloadReceiptAsPdf(receipt: RentReceipt): void {
  const payload = buildReceiptDisplayPayload(receipt);
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a5',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 12;

  // Borde superior de estado
  doc.setFillColor(
    receipt.status === 'voided_by_reversal' ? 185 : 5,
    receipt.status === 'voided_by_reversal' ? 28 : 150,
    receipt.status === 'voided_by_reversal' ? 28 : 105
  );
  doc.rect(margin, 10, pageWidth - margin * 2, 2.5, 'F');

  // Encabezado
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text(payload.tenantName, margin, 20);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  doc.text('RECIBO DE COBRO DE ALQUILER', margin, 25);

  doc.setTextColor(15, 23, 42);
  doc.setFont('courier', 'bold');
  doc.setFontSize(13);
  doc.text(payload.receiptNumber, pageWidth - margin, 20, { align: 'right' });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  if (receipt.status === 'voided_by_reversal') {
    doc.setTextColor(220, 38, 38);
  } else {
    doc.setTextColor(4, 120, 87);
  }
  doc.text(payload.statusLabel, pageWidth - margin, 25, { align: 'right' });

  // Caja de importe
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(margin, 30, pageWidth - margin * 2, 18, 2, 2, 'FD');

  doc.setTextColor(100, 116, 139);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(`IMPORTE RECIBIDO (${payload.currency})`, margin + 4, 36);

  doc.setTextColor(15, 23, 42);
  doc.setFont('courier', 'bold');
  doc.setFontSize(16);
  doc.text(payload.formattedAmount, margin + 4, 44);

  let y = 56;
  for (const row of payload.rows) {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text(row.label, margin, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(15, 23, 42);
    const wrapped = doc.splitTextToSize(row.value, pageWidth - margin * 2);
    doc.text(wrapped.slice(0, 2), margin, y + 4.5);

    const step = wrapped.length > 1 ? 16 : 12.5;
    doc.setDrawColor(241, 245, 249);
    doc.line(margin, y + step - 3, pageWidth - margin, y + step - 3);
    y += step;
  }

  // Leyenda obligatoria no fiscal
  doc.setFillColor(241, 245, 249);
  doc.rect(margin, 178, pageWidth - margin * 2, 16, 'F');
  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(payload.nonFiscalLegend, pageWidth / 2, 184, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text(
    'Comprobante interno no fiscal · El renderizado conserva la numeracion correlativa original',
    pageWidth / 2,
    190,
    { align: 'center' }
  );

  doc.save(`recibo-${payload.receiptNumber}.pdf`);
}
