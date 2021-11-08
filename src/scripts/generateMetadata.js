const fs = require('fs');
const csv = require('csv/lib/sync');
const path = require('path');

// col indexes
let fNameIndex = 1;
let lNameIndex = 0;
let cidIndex = 5;
let className = '1-year';

// Paths
let basePath = '../data/Parity-Anniversary';
let input = path.join(__dirname, `${basePath}/${className}-with-cid.csv`);
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

let createMataJson = (name, imageCid) => {
  let metadata = {
    name: `${name}, 1 year anniversary at Parity`,
    image: `ipfs://ipfs/${imageCid}`,
    description: `Happy 1 year anniversary ${name}. Thank you for all you have done throughout your journey at Parity.`,
  };
  return JSON.stringify(metadata, null, 2);
};
const generateMetadata = async (hasHeader = true) => {
  let records = readRecordsSync(input);
  for (let row = 0; row < records.length; row++) {
    let data = records[row];
    if (row > 0 || !hasHeader) {
      let name = `${data[fNameIndex]} ${data[lNameIndex]}`;
      let imageCid = data[cidIndex];
      let meta = createMataJson(name, imageCid);
      let output = `${metaBaseFolder}/${row + 1}.json`;
      fs.writeFileSync(output, meta, { encoding: 'utf8' });
    }
  }
};

generateMetadata()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
