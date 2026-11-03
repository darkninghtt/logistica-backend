import type { Readable } from 'node:stream';
import PDFDocument from 'pdfkit';
import {
  REPORT_TIME_ZONE,
  type KardexRow,
  type ReportProduct,
  type ReportWarehouse,
  type ShrinkageReport,
} from '../domain/reports';
import type { MovementType } from '../domain/stock';

/** Archivo listo para descargar: el controlador solo pone las cabeceras y lo envía. */
export interface ReportFile {
  filename: string;
  contentType: string;
  /** El CSV es texto; el PDF se genera por streaming (no se arma completo en memoria). */
  body: string | Readable;
}

const MOVEMENT_LABELS: Record<MovementType, string> = {
  ENTRY: 'Entrada',
  TRANSFER_OUT: 'Salida por traspaso',
  TRANSFER_IN: 'Entrada por traspaso',
  SHRINKAGE: 'Merma',
  TRANSIT_SHRINKAGE: 'Merma en tránsito',
  ADJUSTMENT_IN: 'Ajuste de entrada',
};

const REASON_LABELS: Record<string, string> = {
  DAMAGE: 'Daño',
  EXPIRED: 'Vencimiento',
  THEFT: 'Robo',
  COUNT_ADJUSTMENT: 'Ajuste de conteo',
};

/** Motivo legible: el código de una merma ("DAMAGE" o "DAMAGE: nota") se traduce; lo demás, igual. */
function reasonLabel(reason: string | null): string {
  if (!reason) return '';
  const separator = reason.indexOf(': ');
  const code = separator === -1 ? reason : reason.slice(0, separator);
  const label = Object.hasOwn(REASON_LABELS, code) ? REASON_LABELS[code] : undefined;
  if (!label) return reason;
  return separator === -1 ? label : `${label}: ${reason.slice(separator + 2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { timeZone: REPORT_TIME_ZONE });
}

/** Solo letras, números y guiones en el nombre del archivo (evita romper la cabecera). */
function safeName(part: string): string {
  return part.replace(/[^A-Za-z0-9-]+/g, '_');
}

type Cell = string | number;

/**
 * Celda CSV (RFC 4180): entre comillas si lleva coma, comillas o salto de línea. Un texto que
 * empieza por = + - @ se antepone con ' para que Excel no lo ejecute como fórmula (inyección de
 * fórmulas: los motivos y nombres los escribe la gente). Los números van tal cual.
 */
function csvCell(value: Cell): string {
  if (typeof value === 'number') return String(value);
  const text = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV en UTF-8 con BOM (así Excel muestra bien las tildes) y saltos de línea CRLF. */
export function toCsv(headers: readonly string[], rows: readonly Cell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

const KARDEX_HEADERS = [
  'Fecha',
  'Tipo',
  'Referencia',
  'Entrada',
  'Salida',
  'Saldo',
  'Costo unitario',
  'CPP',
  'Valor del saldo',
] as const;

function kardexReference(row: KardexRow): string {
  if (row.type === 'TRANSIT_SHRINKAGE') {
    const reason = row.reference === row.transferId ? '' : reasonLabel(row.reference);
    return `${row.quantity} perdidas en tránsito${reason ? ` · ${reason}` : ''}`;
  }
  if (row.reference === row.transferId && row.transferId) return `Traspaso ${row.transferId}`;
  return reasonLabel(row.reference);
}

function kardexCells(row: KardexRow): Cell[] {
  return [
    formatDate(row.createdAt),
    MOVEMENT_LABELS[row.type],
    kardexReference(row),
    row.quantityIn,
    row.quantityOut,
    row.balanceQty,
    row.unitCost,
    row.balanceAvgCost,
    row.balanceValue,
  ];
}

const SHRINKAGE_HEADERS = [
  'Bodega',
  'SKU',
  'Producto',
  'Tipo',
  'Motivo',
  'Cantidad',
  'Valor',
] as const;

function shrinkageCells(report: ShrinkageReport): Cell[][] {
  return report.data.map((row) => [
    `${row.warehouseCode} · ${row.warehouseName}`,
    row.productSku,
    row.productName,
    MOVEMENT_LABELS[row.type],
    reasonLabel(row.reason),
    row.quantity,
    row.value,
  ]);
}

function shrinkageTotalsRow(report: ShrinkageReport): Cell[] {
  return ['Total', '', '', '', '', report.totals.quantity, report.totals.value];
}

export interface KardexExport {
  warehouse: ReportWarehouse;
  product: ReportProduct;
  rows: KardexRow[];
}

export interface ShrinkageExport {
  report: ShrinkageReport;
  from?: string;
  to?: string;
}

function kardexFilename(data: KardexExport, extension: string): string {
  return `kardex-${safeName(data.warehouse.code)}-${safeName(data.product.sku)}.${extension}`;
}

function shrinkageFilename(data: ShrinkageExport, extension: string): string {
  return `mermas-${data.from ?? 'inicio'}-a-${data.to ?? 'hoy'}.${extension}`;
}

const CSV_TYPE = 'text/csv; charset=utf-8';
const PDF_TYPE = 'application/pdf';

export function kardexCsv(data: KardexExport): ReportFile {
  return {
    filename: kardexFilename(data, 'csv'),
    contentType: CSV_TYPE,
    body: toCsv(KARDEX_HEADERS, data.rows.map(kardexCells)),
  };
}

export function shrinkageCsv(data: ShrinkageExport): ReportFile {
  const rows = [...shrinkageCells(data.report), shrinkageTotalsRow(data.report)];
  return {
    filename: shrinkageFilename(data, 'csv'),
    contentType: CSV_TYPE,
    body: toCsv(SHRINKAGE_HEADERS, rows),
  };
}

interface Column {
  header: string;
  width: number;
  align?: 'left' | 'right';
}

const MARGIN = 36;
const FONT_SIZE = 8;
const ROW_GAP = 4;

/**
 * Tabla simple en un PDF A4 horizontal: título, subtítulos y filas; repite el encabezado en cada
 * página. Helvetica (fuente estándar del PDF) ya trae las tildes y la ñ.
 */
function pdfTable(
  title: string,
  subtitles: readonly string[],
  columns: readonly Column[],
  rows: readonly Cell[][],
): Readable {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: MARGIN });
  const bottom = doc.page.height - MARGIN;

  doc.font('Helvetica-Bold').fontSize(14).text(title);
  doc.font('Helvetica').fontSize(9);
  for (const line of subtitles) doc.text(line);
  doc.moveDown();

  function drawRow(cells: readonly Cell[], bold: boolean): void {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(FONT_SIZE);
    const heights = cells.map((cell, i) =>
      doc.heightOfString(String(cell), { width: columns[i]?.width ?? 50 }),
    );
    const height = Math.max(...heights) + ROW_GAP;
    if (doc.y + height > bottom) {
      doc.addPage();
      if (!bold)
        drawRow(
          columns.map((c) => c.header),
          true,
        );
    }
    const y = doc.y;
    let x = MARGIN;
    cells.forEach((cell, i) => {
      const column = columns[i];
      if (!column) return;
      doc.text(String(cell), x, y, { width: column.width, align: column.align ?? 'left' });
      x += column.width;
    });
    doc.x = MARGIN;
    doc.y = y + height;
  }

  drawRow(
    columns.map((c) => c.header),
    true,
  );
  for (const row of rows) drawRow(row, false);
  if (rows.length === 0) doc.font('Helvetica').fontSize(9).text('Sin datos para este filtro.');
  doc.end();
  return doc;
}

const KARDEX_COLUMNS: readonly Column[] = [
  { header: 'Fecha', width: 100 },
  { header: 'Tipo', width: 95 },
  { header: 'Referencia', width: 180 },
  { header: 'Entrada', width: 45, align: 'right' },
  { header: 'Salida', width: 45, align: 'right' },
  { header: 'Saldo', width: 45, align: 'right' },
  { header: 'Costo unitario', width: 65, align: 'right' },
  { header: 'CPP', width: 65, align: 'right' },
  { header: 'Valor del saldo', width: 75, align: 'right' },
];

const SHRINKAGE_COLUMNS: readonly Column[] = [
  { header: 'Bodega', width: 140 },
  { header: 'SKU', width: 80 },
  { header: 'Producto', width: 160 },
  { header: 'Tipo', width: 95 },
  { header: 'Motivo', width: 110 },
  { header: 'Cantidad', width: 60, align: 'right' },
  { header: 'Valor', width: 75, align: 'right' },
];

export function kardexPdf(data: KardexExport, generatedAt: Date): ReportFile {
  return {
    filename: kardexFilename(data, 'pdf'),
    contentType: PDF_TYPE,
    body: pdfTable(
      'Kardex valorizado',
      [
        `Producto: ${data.product.sku} · ${data.product.name} (${data.product.unit})`,
        `Bodega: ${data.warehouse.code} · ${data.warehouse.name}`,
        `Generado: ${formatDate(generatedAt.toISOString())}`,
      ],
      KARDEX_COLUMNS,
      data.rows.map(kardexCells),
    ),
  };
}

export function shrinkagePdf(data: ShrinkageExport, generatedAt: Date): ReportFile {
  return {
    filename: shrinkageFilename(data, 'pdf'),
    contentType: PDF_TYPE,
    body: pdfTable(
      'Reporte de mermas',
      [
        `Periodo: ${data.from ?? 'desde el inicio'} a ${data.to ?? 'hoy'}`,
        `Generado: ${formatDate(generatedAt.toISOString())}`,
      ],
      SHRINKAGE_COLUMNS,
      [...shrinkageCells(data.report), shrinkageTotalsRow(data.report)],
    ),
  };
}
