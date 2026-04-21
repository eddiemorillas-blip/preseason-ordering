const { parsePastedGrid } = require('../pasteParser');

describe('parsePastedGrid', () => {
  test('TSV — basic tab-separated', () => {
    const input = "UPC\tQty\n840016123456\t2\n840016123457\t4";
    const result = parsePastedGrid(input, { hasHeaders: true });
    expect(result.separator).toBe('tab');
    expect(result.headers).toEqual(['UPC', 'Qty']);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['840016123456', '2']);
    expect(result.rows[1]).toEqual(['840016123457', '4']);
    expect(result.warnings).toHaveLength(0);
  });

  test('CSV — comma-separated', () => {
    const input = "840016123456,2,SLC\n840016123457,4,Ogden";
    const result = parsePastedGrid(input, { separator: 'comma' });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['840016123456', '2', 'SLC']);
  });

  test('CSV with mixed quoting', () => {
    const input = '"840016123456","Shoe, Running",2\n840016123457,Boot,1';
    const result = parsePastedGrid(input, { separator: 'comma' });
    expect(result.rows[0]).toEqual(['840016123456', 'Shoe, Running', '2']);
    expect(result.rows[1]).toEqual(['840016123457', 'Boot', '1']);
  });

  test('CSV with escaped quotes', () => {
    const input = '"UPC ""test""",Qty\n840016123456,2';
    const result = parsePastedGrid(input, { separator: 'comma', hasHeaders: true });
    expect(result.headers).toEqual(['UPC "test"', 'Qty']);
    expect(result.rows).toHaveLength(1);
  });

  test('pipe-delimited', () => {
    const input = "840016123456|2|SLC\n840016123457|4|Ogden";
    const result = parsePastedGrid(input);
    expect(result.separator).toBe('pipe');
    expect(result.rows[0]).toEqual(['840016123456', '2', 'SLC']);
  });

  test('semicolon-delimited', () => {
    const input = "840016123456;2;SLC\n840016123457;4;Ogden";
    const result = parsePastedGrid(input);
    expect(result.separator).toBe('semicolon');
    expect(result.rows[0]).toEqual(['840016123456', '2', 'SLC']);
  });

  test('trailing blank rows stripped', () => {
    const input = "840016123456\t2\n840016123457\t4\n\n\n";
    const result = parsePastedGrid(input);
    expect(result.rows).toHaveLength(2);
  });

  test('single-column paste (just UPCs)', () => {
    const input = "840016123456\n840016123457\n840016123458";
    const result = parsePastedGrid(input);
    expect(result.rows).toHaveLength(3);
    expect(result.rows[0]).toEqual(['840016123456']);
  });

  test('Excel-style \\r\\n line endings', () => {
    const input = "840016123456\t2\r\n840016123457\t4\r\n";
    const result = parsePastedGrid(input);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['840016123456', '2']);
  });

  test('auto-detects tab over comma when tabs present', () => {
    const input = "a,b\tc\t2\nd,e\tf\t3";
    const result = parsePastedGrid(input);
    expect(result.separator).toBe('tab');
  });

  test('empty input returns warnings', () => {
    const result = parsePastedGrid('');
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('null input returns warnings', () => {
    const result = parsePastedGrid(null);
    expect(result.rows).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  test('hasHeaders=false keeps first row as data', () => {
    const input = "UPC\tQty\n840016123456\t2";
    const result = parsePastedGrid(input, { hasHeaders: false });
    expect(result.headers).toBeNull();
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual(['UPC', 'Qty']);
  });

  test('preserves empty cells in the middle', () => {
    const input = "840016123456\t\t2\n840016123457\tSLC\t4";
    const result = parsePastedGrid(input);
    expect(result.rows[0]).toEqual(['840016123456', '', '2']);
    expect(result.rows[1]).toEqual(['840016123457', 'SLC', '4']);
  });
});
