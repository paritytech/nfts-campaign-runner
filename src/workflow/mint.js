const { signAndSendTx } = require('../chain/txHandler');

let mintClassInstances = async (
  network,
  classId,
  startInstanceId,
  owners,
  dryRun
) => {
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
};

let burnInstances = async (network, classId, instanceIds, dryRun) => {
  const { api, signingPair, proxiedAddress } = network;

  let txs = [];
  for (let instanceId of instanceIds) {
    txs.push(api.tx.uniques.burn(classId, instanceId, null));

    const hasMetadata = (
      await api.query.uniques.instanceMetadataOf(classId, instanceId)
    ).isSome;
    // if instance has metadata, clear its metadata
    if (hasMetadata) {
      txs.push(api.tx.uniques.clearMetadata(classId, instanceId));
    }
  }

  instanceIds?.forEach((instanceId) => {});

  let txBatch = api.tx.utility.batchAll(txs);
  let call = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
    : txBatch;
  await signAndSendTx(api, call, signingPair, true, dryRun);
};

module.exports = { mintClassInstances, burnInstances };
