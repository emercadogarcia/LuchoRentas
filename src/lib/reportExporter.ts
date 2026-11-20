/**
 * Archivo: src/lib/reportExporter.ts
 * Responsabilidad: Exportación autorizada de reportes financieros de LuchoRentas
 *   en formatos CSV (UTF-8 con BOM) y PDF (jsPDF A4) manteniendo estrictamente
 *   separadas las divisas BOB y USD y la leyenda informativa de propietarios.
 * Cumplimiento LuchoRentas.md: RF-058 (CA-058), §4.9, DEC-01, DEC-11 y America/La_Paz.
 */
import { jsPDF } from 'jspdf';
import { BOLIVIA_MONTH_LABELS, buildReportCsv } from './phase6Domain';
import { formatBoliviaDateTime, formatCurrencyAmount } from './rbac';
import type { FinancialReportsData, ReportTabKind } from '../types/domain';

export function downloadReportCsv(
  report: FinancialReportsData,
  tab: ReportTabKind,
  tenantName: string
): void {
  const csv = buildReportCsv(report, tab, tenantName);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const periodSlug = `${report.year}-${String(report.month).padStart(2, '0')}`;
  a.href = url;
  a.download = `LuchoRentas-${tab}-${periodSlug}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadReportPdf(
  report: FinancialReportsData,
  tab: ReportTabKind,
  tenantName: string
): void {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
  });

  const periodLabel = `${BOLIVIA_MONTH_LABELS[report.month - 1]} ${report.year}`;
  const tabTitle =
    tab === 'consolidated'
      ? 'Reporte Consolidado de Ingresos y Egresos'
      : tab === 'by_property'
        ? 'Reporte Financiero por Casa'
        : 'Reporte Informativo por Propietario';

  let y = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;

  doc.setFillColor(5, 150, 105);
  doc.rect(marginX, 28, pageWidth - marginX * 2, 4, 'F');

  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(15);
  doc.text(tenantName, marginX, y);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(71, 85, 105);
  doc.text(`${tabTitle} · Período: ${periodLabel} (America/La_Paz)`, marginX, y + 16);
  doc.text(
    `Generado: ${formatBoliviaDateTime(new Date().toISOString())} · Monedas separadas BOB / USD`,
    marginX,
    y + 30
  );

  y += 52;
  doc.setDrawColor(226, 232, 240);
  doc.line(marginX, y, pageWidth - marginX, y);
  y += 18;

  const ensureSpace = (needed: number) => {
    if (y + needed > doc.internal.pageSize.getHeight() - 48) {
      doc.addPage();
      y = 48;
    }
  };

  if (tab === 'consolidated') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(15, 23, 42);
    doc.text('Resumen por moneda (sin conversión automática implícita)', marginX, y);
    y += 16;

    const summaryRows: Array<[string, string, string]> = [
      [
        'Cobros confirmados',
        formatCurrencyAmount(report.collectedTotals.BOB, 'BOB'),
        formatCurrencyAmount(report.collectedTotals.USD, 'USD'),
      ],
      [
        'Egresos pagados',
        formatCurrencyAmount(report.paidExpensesTotals.BOB, 'BOB'),
        formatCurrencyAmount(report.paidExpensesTotals.USD, 'USD'),
      ],
      [
        'Resultado operativo',
        formatCurrencyAmount(report.operatingResultTotals.BOB, 'BOB'),
        formatCurrencyAmount(report.operatingResultTotals.USD, 'USD'),
      ],
      [
        'Saldo CxC al cierre',
        formatCurrencyAmount(report.receivablesClosingTotals.BOB, 'BOB'),
        formatCurrencyAmount(report.receivablesClosingTotals.USD, 'USD'),
      ],
      [
        'Saldo CxP al cierre',
        formatCurrencyAmount(report.payablesClosingTotals.BOB, 'BOB'),
        formatCurrencyAmount(report.payablesClosingTotals.USD, 'USD'),
      ],
    ];

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    for (const [label, bobVal, usdVal] of summaryRows) {
      ensureSpace(18);
      doc.setTextColor(51, 65, 85);
      doc.text(label, marginX, y);
      doc.setFont('courier', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(bobVal, 340, y, { align: 'right' });
      doc.text(usdVal, pageWidth - marginX, y, { align: 'right' });
      doc.setFont('helvetica', 'normal');
      y += 16;
    }

    y += 14;
    ensureSpace(28);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('Movimientos confirmados del período', marginX, y);
    y += 14;

    doc.setFontSize(8.5);
    for (const mov of report.movements.slice(0, 35)) {
      ensureSpace(16);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(71, 85, 105);
      const tipo = mov.kind === 'inflow' ? 'Entrada' : 'Salida';
      doc.text(
        `${formatBoliviaDateTime(mov.effectiveAt)} · ${tipo} · ${mov.propertyName} · ${mov.concept}`.slice(
          0,
          72
        ),
        marginX,
        y
      );
      doc.setFont('courier', 'bold');
      doc.setTextColor(15, 23, 42);
      doc.text(formatCurrencyAmount(mov.amount, mov.currency), pageWidth - marginX, y, {
        align: 'right',
      });
      y += 14;
    }
  } else if (tab === 'by_property') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(15, 23, 42);
    doc.text('Desglose financiero por Casa (BOB / USD separados)', marginX, y);
    y += 18;

    for (const p of report.byProperty) {
      ensureSpace(54);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(15, 23, 42);
      doc.text(
        `${p.propertyName} (${p.occupiedUnitsCount}/${p.enabledUnitsCount} unidades ocupadas)`,
        marginX,
        y
      );
      y += 14;
      doc.setFont('courier', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);
      doc.text(
        `BOB -> Cobros: ${formatCurrencyAmount(p.collected.BOB, 'BOB')} | Pagos: ${formatCurrencyAmount(p.paidExpenses.BOB, 'BOB')} | Neto: ${formatCurrencyAmount(p.operatingResult.BOB, 'BOB')}`,
        marginX + 8,
        y
      );
      y += 13;
      doc.text(
        `USD -> Cobros: ${formatCurrencyAmount(p.collected.USD, 'USD')} | Pagos: ${formatCurrencyAmount(p.paidExpenses.USD, 'USD')} | Neto: ${formatCurrencyAmount(p.operatingResult.USD, 'USD')}`,
        marginX + 8,
        y
      );
      y += 18;
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(180, 83, 9);
    doc.text(
      'Aviso: Reporte estrictamente informativo por participación vigente. No calcula comisiones ni liquidaciones.',
      marginX,
      y
    );
    y += 20;

    for (const ow of report.byOwner) {
      ensureSpace(58);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(15, 23, 42);
      doc.text(ow.ownerName, marginX, y);
      y += 14;
      doc.setFont('courier', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(51, 65, 85);
      doc.text(
        `Total atribuible BOB -> Cobros: ${formatCurrencyAmount(ow.attributableCollected.BOB, 'BOB')} | Gastos: ${formatCurrencyAmount(ow.attributablePaidExpenses.BOB, 'BOB')} | Resultado: ${formatCurrencyAmount(ow.attributableOperatingResult.BOB, 'BOB')}`,
        marginX + 8,
        y
      );
      y += 13;
      doc.text(
        `Total atribuible USD -> Cobros: ${formatCurrencyAmount(ow.attributableCollected.USD, 'USD')} | Gastos: ${formatCurrencyAmount(ow.attributablePaidExpenses.USD, 'USD')} | Resultado: ${formatCurrencyAmount(ow.attributableOperatingResult.USD, 'USD')}`,
        marginX + 8,
        y
      );
      y += 14;
      for (const sh of ow.properties) {
        ensureSpace(16);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.text(
          `· ${sh.propertyName} (${sh.ownershipPercent}%): Neto BOB ${formatCurrencyAmount(sh.operatingResult.BOB, 'BOB')} / USD ${formatCurrencyAmount(sh.operatingResult.USD, 'USD')}`,
          marginX + 14,
          y
        );
        y += 13;
      }
      y += 8;
    }
  }

  const periodSlug = `${report.year}-${String(report.month).padStart(2, '0')}`;
  doc.save(`LuchoRentas-${tab}-${periodSlug}.pdf`);
}
