const { signAndSendTx } = require('../chain/txHandler');

let mintClassInstances = async (network, classId, startInstanceId, owners, dryRun) => {
  const { api, signingPair, proxiedAddress } = network;

  let instanceId = startInstanceId || 0;
  let txs = [];
  for (let i = 0; i < owners.length; i++) {
    txs.push(api.tx.uniques.mint(classId, instanceId, owners[i]));
    instanceId += 1;
  }

  let txBatch = api.tx.utility.batchAll(txs);
  let call = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
    : txBatch;
  await signAndSendTx(api, call, signingPair, true, dryRun);

  if (!dryRun) console.log(call.toHuman());
};

module.exports = { mintClassInstances };
