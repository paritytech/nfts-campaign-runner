const pinFile = require('./pinata/pinFile');
const fs = require('fs');
const csv = require('csv/lib/sync');
const path = require('path');

let metaIndex = 6;
let metaColName = 'metadata cid';
let className = '1-year';
// Paths
// Paths
let basePath = '../data/Parity-Anniversary';
let input = path.join(__dirname, `${basePath}/${className}-with-cid.csv`);
let output = path.join(__dirname, `${basePath}/${className}-with-meta.csv`);
let metaBaseFolder = path.join(__dirname, `${basePath}/NFTs/${className}`);

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

const pinAndSetMetaCid = async (hasHeader = true) => {
  let records = readRecordsSync(input);
  for (let row = 0; row < records.length; row++) {
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
      let cid = '';
      let metadataPath = `${metaBaseFolder}/${row + 1}.json`;
      if (fs.existsSync(metadataPath)) {
        let result = await pinFile(metadataPath, `${className}.${row}.meta`);
        console.log(
          `${className}.${row} was uploaded with cid ${result?.IpfsHash}`
        );
        if (metaIndex < data.length) {
          data[metaIndex] = result.IpfsHash;
        } else {
          data.push(result.IpfsHash);
        }
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
