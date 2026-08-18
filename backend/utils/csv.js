// Minimal RFC4180-style CSV helpers. Handwritten rather than pulling in a
// dependency, since the format here is simple and fixed: no embedded
// newlines-in-quotes edge cases beyond what's handled below, no BOM
// handling, no streaming - just enough to round-trip what generateCsv()
// itself produces, plus reasonably-formed CSV a person exported from a
// spreadsheet.

// Parses a full CSV string into an array of row-arrays (still strings -
// callers validate/convert each field themselves, since what's "valid"
// depends on the column).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  // Normalize line endings up front so \r\n and \r don't need separate
  // handling throughout the loop below.
  const input = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (inQuotes) {
      if (char === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote's second character
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  // Final field/row, if the input didn't end with a newline.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop fully-blank trailing rows (a trailing newline produces one).
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function csvEscapeField(value) {
  const str = value === null || value === undefined ? '' : String(value);
  if (/[",\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// Rows is an array of arrays (strings/numbers); the first row is treated
// as the header like any other row - callers pass it explicitly.
function generateCsv(rows) {
  return rows.map((row) => row.map(csvEscapeField).join(',')).join('\r\n') + '\r\n';
}

module.exports = { parseCsv, generateCsv };
