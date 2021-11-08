const fs = require('fs');
const csv = require('csv/lib/sync');
const path = require('path');
const pinJson = require('./pinata/pinJson');

// col indexes
let fNameIndex = 0;
let lNameIndex = 1;
let cidIndex = 5;
let metaIndex = 6;
let metaColName = 'metadata cid';
let className = '1-year';

// Paths
let basePath = '../data/Parity-Anniversary';
let input = path.join(__dirname, `${basePath}/${className}-with-cid.csv`);
let output = path.join(__dirname, `${basePath}/${className}-with-meta.csv`);

let readRecordsSync = (input) => {
  const data = fs.readFileSync(input);

  let records = csv.parse(data);

  records = records.map((field) =>
    field.includes(',') ? `"${field}"` : field
  );
  return records;
};

let writeRecordsSync = (records, output) => {
  records = records.join('\n');
  fs.writeFileSync(output, records, { encoding: 'utf8' });
};

let createMataJson = (name, imageCid) => {
  let metadata = {
    name: `${name} 1 year anniverary`,
    image: `ipfs://ipfs/${imageCid}`,
    description: `Happy 1 year anniversary ${name}.`,
  };
  return metadata;
};

const pinAndSetMetaCid = async (hasHeader = true) => {
  let records = readRecordsSync(input);
  for (let row = 0; row < 2; row++) {
    let data = records[row];
    if (row === 0 && hasHeader) {
      if (metaIndex < data.length) {
        if (data[metaIndex] !== metaColName) {
          throw new Error(
            `column index ${metaIndex} is not the ${metaColName}`
          );
        }
      } else {
        data.push(metaColName);
      }
    } else {
      let name = `${data[fNameIndex]} ${data[lNameIndex]}`;
      let imageCid = data[cidIndex];
      let meta = createMataJson(name, imageCid);
      console.log(meta);
      let result = await pinJson(meta, `${row}`);
      let metaCid = result.IpfsHash;

      if (metaIndex < data.length) {
        data[metaIndex] = result.IpfsHash;
      } else {
        data.push(result.IpfsHash);
      }
    }
  }
  writeRecordsSync(records, output);
};

pinAndSetMetaCid()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
