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
    txs.push(api.tx.nfts.mint(collectionId, itemId, owners[i], null));
    itemId += 1;
  }

  let txBatch = api.tx.utility.batchAll(txs);
  let call = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
    : txBatch;
  await signAndSendTx(api, call, signingPair, true, dryRun);
};

let burnItems = async (network, collectionId, items, dryRun) => {
  const { api, keyring, signingPair, proxiedAddress } = network;

  let metadataTxs = [];
  let itemBurnTxs = [];

  for (const { itemId, secret } of items) {
    let sourceKeyPair = keyring.createFromUri(secret);
    const tx = api.tx.nfts.burn(collectionId, itemId);
    itemBurnTxs.push(signAndSendTx(api, tx, sourceKeyPair, false, dryRun));

    const hasMetadata = (
      await api.query.nfts.itemMetadataOf(collectionId, itemId)
    ).isSome;
    // if item has metadata, clear its metadata
    if (hasMetadata) {
      metadataTxs.push(api.tx.nfts.clearMetadata(collectionId, itemId));
    }
  }

  console.info('Burning metadatas...');
  let txBatch = api.tx.utility.batchAll(metadataTxs);
  let call = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
    : txBatch;
  await signAndSendTx(api, call, signingPair, true, dryRun);

  console.info('Burning items...');
  if (itemBurnTxs.length > 0) {
    await Promise.all(itemBurnTxs);
  }
};

module.exports = { mintCollectionItems, burnItems };
