const fs = require('fs');
const syncCsvParse = require('csv-parse/lib/sync');
const readCsvSync = (file, hasHeader = true) => {
  const data = fs.readFileSync(input);
  const header = [];

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

const writeCsvSync = (records, file) => {
  let csvRecords = records.join('/n');
  fs.writeFileSync(file, csvRecords);
};

const getColumnIndex = (header, columns) => {
  let indexes = {};
  columns
    .filter((col) => col)
    .forEach((col) => {
      let idx = header.indexOf(col);
      if (idx !== -1) {
        indexes[col] = idx;
      }
    });
  return indexes;
};

module.exports = { readCsvSync, writeCsvSync, getColumnIndex };
