const pinFile = require('./pinata/pinFile');
const fs = require('fs');
const csv = require('csv/lib/sync');
const path = require('path');

let cidIndex = 5;
let cidColName = 'image cid';
let className = '2-year';
// Paths
let basePath = '../data/Parity-Anniversary';
let input = path.join(__dirname, `${basePath}/${className}.csv`);
let output = path.join(__dirname, `${basePath}/${className}-with-cid.csv`);
let imageBaseFolder = path.join(__dirname, `${basePath}/NFTs/${className}`);

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

const pinAndSetImageCid = async (hasHeader = true) => {
  let records = readRecordsSync(input);
  for (let row = 0; row < records.length; row++) {
    let data = records[row];
    if (row === 0 && hasHeader) {
      if (cidIndex < data.length) {
        if (data[cidIndex] !== cidColName) {
          throw new Error(`column index ${cidIndex} is not the ${cidColName}`);
        }
      } else {
        data.push(cidColName);
      }
    } else {
      let cid = '';
      let imagePath = `${imageBaseFolder}/${row + 1}.svg`;
      if (fs.existsSync(imagePath)) {
        let result = await pinFile(imagePath, `${className}.${row}`);
        console.log(
          `${className}.${row} was uploaded with cid ${result?.IpfsHash}`
        );
        if (cidIndex < data.length) {
          data[cidIndex] = result.IpfsHash;
        } else {
          data.push(result.IpfsHash);
        }
      } else {
        console.log(`${imagePath} does not exist.`);
      }
    }
  }
  writeRecordsSync(records, output);
};

pinAndSetImageCid()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
