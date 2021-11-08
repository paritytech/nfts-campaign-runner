const { seed, connect } = require('./chain/chain-statemine');
const { signAndSendTx } = require('./chain/txHandler');

const fs = require('fs');
const csv = require('csv/lib/sync');
const path = require('path');

let addressIndex = 1;
let batchSize = 800;
let totalCount = 68;
let classId = 11;

let readAddresses = (hasHeader = false) => {
  let input = path.join(
    __dirname,
    `../data/Parity-Anniversary/secrets-with-address${classId}.csv`
  );
  const data = fs.readFileSync(input);

  let records = csv.parse(data);
  if (hasHeader) {
    records = records.slice(1);
  }
  let addressList = records
    .map((record) => record[addressIndex])
    .filter((address) => !!address);

  return addressList;
};

let mintClassInstances = async () => {
  const { api, signingPair, proxiedAddress } = await connect();
  let addresses = readAddresses();
  if (addresses.length != totalCount) {
    throw new Error(
      `number of loaded addresses ${addresses.length} is not equal to the target nft count ${totalCount}`
    );
  }

  let instanceId = 0;
  let batchNo = 0;
  while (instanceId < totalCount) {
    let txs = [];
    let startInstanceId = instanceId;
    for (let i = 0; i < batchSize; i += 1) {
      if (instanceId >= totalCount) {
        break;
      }
      txs.push(api.tx.uniques.mint(classId, instanceId, addresses[instanceId]));
      instanceId += 1;
    }
    console.log(
      `Sending batch number ${batchNo} for instanceIds ${startInstanceId}:${instanceId}`
    );
    let txBatch = api.tx.utility.batchAll(txs);
    let call = proxiedAddress
      ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
      : txBatch;
    await signAndSendTx(api, call, signingPair);
    console.log(call.toHuman());
    console.log(`batch number ${batchNo} finished!`);
    batchNo += 1;
  }
};

mintClassInstances()
  .then(() => process.exit(0))
  .catch((error) => {
    console.log(error);
    process.exit(1);
  });
