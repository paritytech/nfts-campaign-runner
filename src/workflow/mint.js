const { signAndSendTx } = require('../chain/txHandler');

let mintCollectionItems = async (
  network,
  collectionId,
  startItemId,
  owners,
  dryRun
) => {
  const { api, signingPair, proxiedAddress } = network;

  let itemId = startItemId || 0;
  let txs = [];
  for (let i = 0; i < owners.length; i++) {
    txs.push(api.tx.uniques.mint(collectionId, itemId, owners[i]));
    itemId += 1;
  }

  let txBatch = api.tx.utility.batchAll(txs);
  let call = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
    : txBatch;
  await signAndSendTx(api, call, signingPair, true, dryRun);
};

let burnItems = async (network, collectionId, itemIds, dryRun) => {
  const { api, signingPair, proxiedAddress } = network;

  let txs = [];
  for (let itemId of itemIds) {
    txs.push(api.tx.uniques.burn(collectionId, itemId, null));

    const hasMetadata = (
      await api.query.uniques.instanceMetadataOf(collectionId, itemId)
    ).isSome;
    // if item has metadata, clear its metadata
    if (hasMetadata) {
      txs.push(api.tx.uniques.clearMetadata(collectionId, itemId));
    }
  }

  itemIds?.forEach((itemId) => {});

  let txBatch = api.tx.utility.batchAll(txs);
  let call = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
    : txBatch;
  await signAndSendTx(api, call, signingPair, true, dryRun);
};

module.exports = { mintCollectionItems, burnItems };
