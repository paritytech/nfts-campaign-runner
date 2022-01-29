const fs = require('fs');
const { parse } = require('csv-parse/sync');

const readCsvSync = (file, hasHeader = true) => {
  const data = fs.readFileSync(file);
  let header = [];

  let records = parse(data, {
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

const getColumnIndex = (header, columnTitles) => {
  let indexes = [];
  columnTitles.forEach((col) => {
    if (!col) {
      indexes.push(null);
    } else {
      let idx = header?.indexOf(col);
      idx = idx === -1 ? null : idx;
      indexes.push(idx);
    }
  });
  return indexes;
};

const fillTemplateFromData = (template, header, data) => {
  const pattern = /<<[^<>]+>>/g; // {property}
  return template.replace(pattern, (token) => {
    let columnTitle = token.replace(/[<>]+/g, '');
    let [idx] = getColumnIndex(header, [columnTitle]);
    let result = idx != null ? data[idx] : '';
    return result;
  });
};

const getColumns = (columnTitles, header, records) => {
  const columnIdxs = getColumnIndex(header, columnTitles);
  let columns = columnTitles.map((title) => ({ title, records: [] }));
  records.forEach((record) => {
    for (let i = 0; i < columnTitles.length; i++) {
      columns[i].records.push(record[columnIdxs[i]]);
    }
  });
  return columns;
};

module.exports = {
  readCsvSync,
  writeCsvSync,
  getColumnIndex,
  getColumns,
  fillTemplateFromData,
};
