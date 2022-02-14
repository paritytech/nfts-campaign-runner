const { signAndSendTx } = require('../chain/txHandler');

let transferFunds = async (network, owners, amount, dryRun) => {
  const { api, signingPair, proxiedAddress } = network;

  let txs = [];
  for (let i = 0; i < owners.length; i++) {
    txs.push(api.tx.balances.transfer(owners[i], amount));
  }

  let txBatch = api.tx.utility.batchAll(txs);
  let call = proxiedAddress
    ? api.tx.proxy.proxy(proxiedAddress, 'Assets', txBatch)
    : txBatch;
  await signAndSendTx(api, call, signingPair, true, dryRun);
};

module.exports = { transferFunds };
