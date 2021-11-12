const fs = require('fs');
const syncCsvParse = require('csv-parse/lib/sync');
const readCsvSync = (file, hasHeader = true) => {
  const data = fs.readFileSync(file);
  let header = [];

  let records = syncCsvParse(data, {
    skip_empty_lines: true,
  });

  records = records.map((field) =>
    field.includes(',') ? `"${field}"` : field
  );
  if (hasHeader && records.length > 0) {
    header = records[0];
    records = records.slice(1);
  }
  return { header, records };
};

const writeCsvSync = (file, headers, records) => {
  let data = [headers, ...records];
  let csvRecords = data.join('\n');
  fs.writeFileSync(file, csvRecords);
};

const getColumnIndex = (header, columns) => {
  let indexes = {};
  columns.forEach((col) => {
    if (!col) {
      indexes.push(null);
    } else {
      let idx = header.indexOf(col);
      idx = idx === -1 ? null : idx;
      indexes.push(idx);
    }
  });
  return indexes;
};

module.exports = { readCsvSync, writeCsvSync, getColumnIndex };
