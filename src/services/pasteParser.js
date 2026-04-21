/**
 * Paste Parser — parse clipboard-pasted grid data into rows/columns.
 *
 * Supports TSV, CSV, pipe-delimited, semicolon-delimited.
 * Auto-detects separator if not specified.
 */

const SEPARATORS = {
  tab: '\t',
  comma: ',',
  pipe: '|',
  semicolon: ';',
};

/**
 * Parse a raw pasted text block into a 2D grid.
 *
 * @param {string} rawText - The pasted text
 * @param {Object} [options]
 * @param {string} [options.separator] - 'tab'|'comma'|'pipe'|'semicolon' or the char itself. Auto-detect if omitted.
 * @param {boolean} [options.hasHeaders=false] - If true, first row is treated as headers.
 * @returns {{ rows: string[][], headers: string[]|null, separator: string, warnings: string[] }}
 */
function parsePastedGrid(rawText, options = {}) {
  const warnings = [];

  if (!rawText || typeof rawText !== 'string') {
    return { rows: [], headers: null, separator: 'tab', warnings: ['Empty or invalid input'] };
  }

  // Normalize line endings
  const text = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Split into lines, remove trailing blank lines
  let lines = text.split('\n');
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    return { rows: [], headers: null, separator: 'tab', warnings: ['No data lines found'] };
  }

  // Detect or resolve separator
  let sep;
  let sepName;

  if (options.separator) {
    // Named separator or literal char
    sep = SEPARATORS[options.separator] || options.separator;
    sepName = options.separator;
  } else {
    // Auto-detect: count occurrences in first few lines
    const sample = lines.slice(0, Math.min(5, lines.length)).join('\n');
    const counts = {
      tab: (sample.match(/\t/g) || []).length,
      comma: (sample.match(/,/g) || []).length,
      pipe: (sample.match(/\|/g) || []).length,
      semicolon: (sample.match(/;/g) || []).length,
    };

    // Prefer tab (Excel default), then highest count
    if (counts.tab > 0) {
      sep = '\t'; sepName = 'tab';
    } else {
      const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
      if (best[1] > 0) {
        sep = SEPARATORS[best[0]]; sepName = best[0];
      } else {
        // No separators found — treat each line as a single column
        sep = '\t'; sepName = 'tab';
        if (lines.length > 1 || lines[0].length > 20) {
          warnings.push('No column separator detected — treating each line as a single value');
        }
      }
    }
  }

  // Parse rows — handle quoted fields for CSV
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue; // skip blank interior lines

    let cells;
    if (sep === ',' && line.includes('"')) {
      // CSV with quoting — simple state machine
      cells = parseCSVLine(line);
    } else {
      cells = line.split(sep).map(c => c.trim());
    }
    rows.push(cells);
  }

  if (rows.length === 0) {
    return { rows: [], headers: null, separator: sepName, warnings: ['No data rows after parsing'] };
  }

  // Cap warning
  if (rows.length > 10000) {
    warnings.push(`Pasted data has ${rows.length} rows — capped at 10,000 for processing`);
  }

  const hasHeaders = options.hasHeaders === true;
  let headers = null;
  let dataRows = rows;

  if (hasHeaders && rows.length > 0) {
    headers = rows[0];
    dataRows = rows.slice(1);
  }

  return {
    rows: dataRows.slice(0, 10000),
    headers,
    separator: sepName,
    warnings,
  };
}

/**
 * Parse a single CSV line that may contain quoted fields.
 */
function parseCSVLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        cells.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  cells.push(current.trim());
  return cells;
}

module.exports = { parsePastedGrid };
