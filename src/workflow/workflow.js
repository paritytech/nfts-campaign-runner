const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const BN = require('bn.js');
const { setTimeout } = require('timers/promises');
const assert = require('assert');
const {
  generateAndSetCollectionMetadata,
  generateMetadata,
  setMetadataInBatch,
} = require('./metadata');
const { generateSecret } = require('./giftSecrets');
const { mintCollectionItems, burnItems } = require('./mint');
const { transferFunds } = require('./balanceTransfer');
const {
  columnTitles,
  checkPreviousCheckpoints,
  loadContext,
  getContext,
} = require('./context');
const { signAndSendTx } = require('../chain/txHandler');
const inqAsk = inquirer.createPromptModule();
const { parseConfig } = require('./wfConfig');
const { WorkflowError } = require('../Errors');
const { fillTemplateFromData } = require('../utils/csv');
const { isNumber, isEmptyObject, formatBalanceWithUnit } = require('../utils');
const {
  importantMessage,
  stepTitle,
  notificationMessage,
} = require('../utils/styles');

const initialFundPattern = new RegExp('[1-9][0-9]*');
const METADATA_SIZE = 46;

// The adjustment to estimate the actual fee as fee=(FEE_ADJUSTMENT_MULTIPLIER/100)*partialFee
const FEE_ADJUSTMENT_MULTIPLIER = 130;

const executeInBatch = async (batchInfo, action, callback) => {
  let { startRecordNo, endRecordNo, checkpointedBatchNo, batchSize } =
    batchInfo;

  assert(isNumber(startRecordNo), 'batch startRecordNo is not a valid number');
  assert(isNumber(endRecordNo), 'batch endRecordNo is not a valid number');
  assert(isNumber(batchSize), 'batchSize is not a valid number');

  if (checkpointedBatchNo) {
    assert(
      isNumber(checkpointedBatchNo),
      'checkpoinyed batch number is not a valid number'
    );
    console.log(notificationMessage('Checkpoint data spotted'));
  }

  let lastBatch = checkpointedBatchNo ?? 0;
  if (lastBatch) {
    if (startRecordNo + lastBatch * batchSize < endRecordNo) {
      console.log(
        notificationMessage(`Continuing from batch #${lastBatch}\n\n`)
      );
    } else {
      console.log(importantMessage('Nothing left to run'));
    }
  }

  while (startRecordNo + lastBatch * batchSize < endRecordNo) {
    console.log(`\n\nSending batch number ${lastBatch + 1}`);
    let batchStartRecordNo = startRecordNo + lastBatch * batchSize;
    let batchEndRecordNo = Math.min(
      startRecordNo + (lastBatch + 1) * batchSize,
      endRecordNo
    );

    await action(batchStartRecordNo, batchEndRecordNo, lastBatch + 1);
    await callback(batchStartRecordNo, batchEndRecordNo, lastBatch + 1);
    lastBatch += 1;
  }
};

const createCollection = async (wfConfig) => {
  // 1 - create a collection if it does not exist.
  const context = getContext();
  const { api, signingPair, proxiedAddress } = context.network;
  const { dryRun } = context;

  let collectionId = context.collection.id;
  if (context.collection.isExistingCollection) {
    console.info('The collection already exists.');
  } else {
    // create the new collection
    let tx = api.tx.nfts.create(signingPair?.address, {
      settings: 0,
      mintSettings: {
        mintType: 'Issuer',
        defaultItemSettings: 0,
      },
    });
    const call = proxiedAddress
      ? api.tx.proxy.proxy(proxiedAddress, 'Assets', tx)
      : tx;
    const events = await signAndSendTx(api, call, signingPair, true, dryRun);

    let newId;
    for (const { event: { data, method, section } } of events) {
      if (section === 'nfts' && method === 'Created') {
        newId = data[0].toPrimitive();
        break;
      }
    }
    if (newId === undefined) throw new WorkflowError("Unable to detect created collection's id");
    collectionId = newId;
  }
  // set the collection checkpoint
  if (!dryRun) context.collection.checkpoint(collectionId);
};

const setCollectionMetadata = async (wfConfig) => {
  // 2 - generate/set collection metadata
  const context = getContext();
  const { dryRun } = context;

  if (context.collection.id === undefined) {
    throw new WorkflowError(
      'No collection.id checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  if (!context.collection.metaCid) {
    // no collection metadata is recorded in the checkpoint
    let metadata = wfConfig?.collection?.metadata;
    if (!metadata) {
      // no collection metadata is configured. ask user if they want to configure a collection metadata
      let { withoutMetadata } = (await inqAsk([
        {
          type: 'confirm',
          name: 'withoutMetadata',
          message: `No collection metadata is configured in workflow.json, do you want to continue without setting the collection metadata`,
          default: false,
        },
      ])) || { withoutMetadata: false };
      if (!withoutMetadata) {
        throw new WorkflowError(
          'Please configure a collection metadata in workflow.json.'
        );
      }
    } else {
      let metadataFolder = wfConfig.metadataFolder;
      let metadataFile = path.join(metadataFolder, 'collection.meta');
      context.collection.metaCid = await generateAndSetCollectionMetadata(
        context.network,
        context.pinataClient,
        context.collection.id,
        metadata,
        metadataFile
      );
      // update collection checkpoint
      if (!dryRun) context.collection.checkpoint();
    }
  } else {
    console.log(
      notificationMessage('Re-using collection metadata from the checkpoint')
    );
  }
};

const generateGiftSecrets = async (wfConfig) => {
  // 3 - create nft secrets + addresses
  let context = getContext();
  const { dryRun } = context;
  let keyring = context.network.keyring;
  // TODO: check if itemOffset + itemCount is out of bound (> data.length) throw an error
  const [secretColumn, addressColumn] =
    context.data.getColumns([columnTitles.secret, columnTitles.address]) || [];

  let isUpdated = false;
  for (let i = 0; i < context.data.records.length; i++) {
    if (i >= secretColumn.records.length) {
      secretColumn.records.push('');
    }
    if (i >= addressColumn.records.length) {
      addressColumn.records.push('');
    }

    if (
      i >= context.data.startRecordNo &&
      i < context.data.endRecordNo &&
      !secretColumn.records[i]
    ) {
      const { secret, address } = await generateSecret(keyring);
      secretColumn.records[i] = secret;
      addressColumn.records[i] = address;
      isUpdated = true;
    }
  }
  if (isUpdated) {
    context.data.setColumns([secretColumn, addressColumn]);
    if (!dryRun) context.data.checkpoint();
  }
  console.log('Secrets generated');
};

const mintItemsInBatch = async (wfConfig) => {
  // 4 - mint items in batch
  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

  // read collectionId from checkpoint
  if (context.collection.id === undefined) {
    throw new WorkflowError(
      'No collectionId checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  let [addressColumn, itemIdColumn] = context.data.getColumns([
    columnTitles.address,
    columnTitles.itemId,
  ]);
  // add itemId column if not exists
  if (itemIdColumn.records.length === 0) {
    context.data.addColumn(columnTitles.itemId);
  }

  // check Address column exists
  if (
    !addressColumn.records?.[startRecordNo] ||
    !addressColumn.records?.[endRecordNo - 1]
  ) {
    throw new WorkflowError(
      'No address checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  // if collection already has items, start from the first available id to mint new items.
  let startItemId = isNumber(context?.collection?.startItemId)
    ? parseInt(context?.collection?.startItemId)
    : 0;

  // load last minted batch from checkpoint
  let batchSize = parseInt(wfConfig?.item?.batchSize) || 100;
  let lastCheckpointedBatch = context.batch.lastMintBatch;

  let batchInfo = {
    startRecordNo,
    endRecordNo,
    checkpointedBatchNo: lastCheckpointedBatch,
    batchSize,
  };

  let batchAction = async (batchStartRecordNo, batchEndRecordNo, batchNo) => {
    let batchStartItemId = startItemId + (batchNo - 1) * batchSize;
    let ownerAddresses = addressColumn.records;
    await mintCollectionItems(
      context.network,
      context.collection.id,
      batchStartItemId,
      ownerAddresses.slice(batchStartRecordNo, batchEndRecordNo),
      dryRun
    );

    let currentItemId = startItemId + (batchNo - 1) * batchSize;
    for (let i = batchStartRecordNo; i < batchEndRecordNo; i++) {
      itemIdColumn.records[i] = currentItemId;
      currentItemId += 1;
    }
    context.data.setColumns([itemIdColumn]);
  };

  let batchCheckpointCb = async (
    batchStartRecordNo,
    batchEndRecordNo,
    batchNo
  ) => {
    if (!dryRun) {
      // set checkpoint for itemIds
      context.data.checkpoint();

      // set checkpoint for mint batch
      context.batch.lastMintBatch = batchNo;
      context.batch.checkpoint();
    }
  };

  await executeInBatch(batchInfo, batchAction, batchCheckpointCb);
};

const formatFileName = (fileNameTemplate, rowNumber, { header, records }) => {
  if (fileNameTemplate.includes('<>')) {
    return fileNameTemplate.replace('<>', rowNumber);
  }

  return fillTemplateFromData(fileNameTemplate, header, records);
};

const pinAndSetImageCid = async (wfConfig) => {
  // 5 - pin images and generate metadata
  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

  // set the metadata for items in batch
  let batchSize = parseInt(wfConfig?.item?.batchSize) || 100;
  let lastCheckpointedBatch = context.batch.lastMetaCidBatch || 0;

  const rowNumber = (zerobasedIdx) => zerobasedIdx + 2;
  const itemMetadata = wfConfig?.item?.metadata;
  if (isEmptyObject(itemMetadata)) {
    return;
  }
  const {
    name,
    description,
    imageFolder,
    imageFileNameTemplate,
    videoFolder,
    videoFileNameTemplate,
  } = itemMetadata;

  const [imageCidColumn, metaCidColumn, videoCidColumn] =
    context.data.getColumns([
      columnTitles.imageCid,
      columnTitles.metaCid,
      columnTitles.videoCid,
    ]);

  // add missing columns
  if (imageCidColumn.records.length === 0) {
    context.data.addColumn(columnTitles.imageCid);
  }
  if (metaCidColumn.records.length === 0) {
    context.data.addColumn(columnTitles.metaCid);
  }
  if (videoCidColumn.records.length === 0) {
    context.data.addColumn(columnTitles.videoCid);
  }
  let batchInfo = {
    startRecordNo,
    endRecordNo,
    checkpointedBatchNo: lastCheckpointedBatch,
    batchSize,
  };

  let batchAction = async (batchStartRecordNo, batchEndRecordNo, batchNo) => {
    let itemsGenerated = 0;
    let totalItems = 0;
    for (let i = batchStartRecordNo; i < batchEndRecordNo; i++) {
      ++totalItems;
      if (metaCidColumn.records[i]) {
        console.log(`metadata for the row #${i} is already uploaded, skipping`);
        continue;
      }

      let imageFile;
      if (imageFileNameTemplate) {
        const imageFileName = formatFileName(
          imageFileNameTemplate,
          rowNumber(i),
          {
            header: context.data.header,
            records: context.data.records[i],
          }
        );
        imageFile = path.join(imageFolder, imageFileName);
      }

      let videoFile;
      if (videoFileNameTemplate) {
        const videoFileName = formatFileName(
          videoFileNameTemplate,
          rowNumber(i),
          {
            header: context.data.header,
            records: context.data.records[i],
          }
        );
        videoFile = path.join(videoFolder, videoFileName);
      }

      // fill template name to build the name string
      const itemName = fillTemplateFromData(
        name,
        context.data.header,
        context.data.records[i]
      );

      // fill template description to build the description string
      const itemDescription = fillTemplateFromData(
        description,
        context.data.header,
        context.data.records[i]
      );

      let metadataName = `row-${rowNumber(i)}.meta`;
      let metadataFolder = wfConfig.metadataFolder;
      let metaPath = path.join(metadataFolder, metadataName);
      const { metaCid, imageCid, videoCid } = await generateMetadata(
        context.pinataClient,
        itemName,
        itemDescription,
        imageFile,
        videoFile,
        metaPath
      );

      imageCidColumn.records[i] = imageCid;
      videoCidColumn.records[i] = videoCid;
      metaCidColumn.records[i] = metaCid;
      ++itemsGenerated;
    }
    if (itemsGenerated) {
      context.data.setColumns([imageCidColumn, metaCidColumn, videoCidColumn]);
      console.log(`${itemsGenerated} metadata(s) uploaded`);
    } else if (!totalItems) {
      console.log(importantMessage('No metadata was uploaded'));
    }
  };

  let batchCheckpointCb = async (
    batchStartRecordNo,
    batchEndRecordNo,
    batchNo
  ) => {
    if (!dryRun) {
      // set data checkpiont
      context.data.checkpoint();

      // set checkpoint batch
      context.batch.lastMetaCidBatch = batchNo;
      context.batch.checkpoint();
    }
  };

  await executeInBatch(batchInfo, batchAction, batchCheckpointCb);
};

const setItemsMetadata = async (wfConfig) => {
  // 6 - set metadata for items
  const itemMetadata = wfConfig?.item?.metadata;
  if (isEmptyObject(itemMetadata)) {
    console.log(
      notificationMessage(
        'Skipped! No item metadata is configured for the workflow'
      )
    );
    return;
  }

  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

  let batchSize = parseInt(wfConfig?.item?.batchSize) || 100;
  let lastCheckpointedBatch = context.batch.lastMetadataBatch || 0;

  // read collectionId from checkpoint
  if (context.collection.id === undefined) {
    throw new WorkflowError(
      'No collectionId checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  const [metaCidColumn, itemIdColumn] = context.data.getColumns([
    columnTitles.metaCid,
    columnTitles.itemId,
  ]);

  if (
    !metaCidColumn.records?.[startRecordNo] ||
    !metaCidColumn.records?.[endRecordNo - 1]
  ) {
    throw new WorkflowError(
      'No metadata checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  if (
    !isNumber(itemIdColumn?.records?.[startRecordNo]) ||
    !isNumber(itemIdColumn?.records?.[endRecordNo - 1])
  ) {
    throw new WorkflowError(
      'No itemId is recorded or the checkpoint is not in a correct state.'
    );
  }

  let batchInfo = {
    startRecordNo,
    endRecordNo,
    checkpointedBatchNo: lastCheckpointedBatch,
    batchSize,
  };

  const batchAction = async (batchStartRecordNo, batchEndRecordNo, _) => {
    let itemMetadatas = [];
    // iterate the rows from startRecordNo to endRecordNo and collect recorded metadata info
    for (let i = batchStartRecordNo; i < batchEndRecordNo; i++) {
      if (!isNumber(itemIdColumn.records?.[i])) {
        throw new WorkflowError(
          `No itemId is recorded for row#: ${i} or the checkpoint is not in a correct state.`
        );
      }
      const metadata = {
        itemId: itemIdColumn.records[i],
        metaCid: metaCidColumn.records[i],
      };
      itemMetadatas.push(metadata);
    }

    await setMetadataInBatch(
      context.network,
      context.collection.id,
      itemMetadatas,
      dryRun
    );
  };

  let batchCheckpointCb = async (
    batchStartRecordNo,
    batchEndRecordNo,
    batchNo
  ) => {
    if (!dryRun) {
      // set data checkpiont
      context.data.checkpoint();

      // set checkpoint batch
      context.batch.lastMetadataBatch = batchNo;
      context.batch.checkpoint();
    }
  };

  await executeInBatch(batchInfo, batchAction, batchCheckpointCb);
};

const sendInitialFunds = async (wfConfig) => {
  // 7 - fund accounts with some initial funds
  let initialFund = wfConfig?.item?.initialFund;

  const context = getContext();
  const { dryRun } = context;
  const { chainInfo } = context.network;
  const { startRecordNo, endRecordNo } = context.data;
  const { api, signingPair } = context.network;
  // calculate minimum initial fund
  const minInitialFund = await calcMinInitialFund();

  // check the value of  the configured initialFund is valid and above the minimum needed funds to claim
  if (
    !initialFund?.match(initialFundPattern) ||
    minInitialFund.lte(new BN(initialFund))
  ) {
    let minInitialFundStr = formatBalanceWithUnit(minInitialFund, chainInfo);
    console.info(
      notificationMessage(
        `\
        \nEach gift account needs to have a minimum balance of ${minInitialFundStr} to cover the claim fee. \
        \nYou have not configured any initialFunds or the configured value is below minimum required amount.
        `
      )
    );
    let message = `Would you like to set the initialFund to ${minInitialFundStr}?.`;
    const { calcInitialFund } = (await inqAsk([
      {
        type: 'confirm',
        name: 'calcInitialFund',
        message,
        default: true,
      },
    ])) || { calcInitialFund: false };

    if (calcInitialFund) {
      initialFund = minInitialFund;
    } else {
      // user refused to set the initialFund, skip this step
      return;
    }
  }

  let [addressColumn] = context.data.getColumns([columnTitles.address]);
  if (
    !addressColumn.records?.[startRecordNo] ||
    !addressColumn.records?.[endRecordNo - 1]
  ) {
    throw new WorkflowError(
      'No address column is recorded in the workflow or the checkpoint is not in a correct state.'
    );
  }

  // load last balanceTx batch from checkpoint
  let batchSize = parseInt(wfConfig?.item?.batchSize) || 100;
  let lastCheckpointedBatch = context.batch.lastBalanceTxBatch;

  let ownerAddresses = addressColumn.records;

  let batchInfo = {
    startRecordNo,
    endRecordNo,
    checkpointedBatchNo: lastCheckpointedBatch,
    batchSize,
  };

  const batchAction = async (batchStartRecordNo, batchEndRecordNo, _) => {
    await transferFunds(
      context.network,
      ownerAddresses.slice(batchStartRecordNo, batchEndRecordNo),
      initialFund,
      dryRun
    );
  };

  let batchCheckpointCb = async (
    batchStartRecordNo,
    batchEndRecordNo,
    batchNo
  ) => {
    if (!dryRun) {
      // set data checkpiont
      context.data.checkpoint();

      // set checkpoint batch
      context.batch.lastBalanceTxBatch = batchNo;
      context.batch.checkpoint();
    }
  };

  await executeInBatch(batchInfo, batchAction, batchCheckpointCb);
};

const reapUnusedFunds = async (wfConfig) => {
  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;
  const { api, keyring, signingPair: seedKeyPair } = context.network;

  let [secretColumn] = context.data.getColumns([columnTitles.secret]);

  // set the destination address to the address derived from the seed in the workflow
  let destAddress = seedKeyPair?.address;
  if (!destAddress) {
    throw WorkflowError(
      'was not able to generate the address from the seed specified by network.seed in the workflow file.'
    );
  }
  // load last minted batch from checkpoint
  let batchSize = parseInt(wfConfig?.item?.batchSize) || 100;

  let batchInfo = {
    startRecordNo,
    endRecordNo,
    checkpointedBatchNo: 0,
    batchSize,
  };

  const batchAction = async (batchStartRecordNo, batchEndRecordNo, batchNo) => {
    let txs = [];
    for (let i = batchStartRecordNo; i < batchEndRecordNo; i++) {
      if (secretColumn.records?.[i]) {
        let sourceKeyPair = keyring.createFromUri(secretColumn.records?.[i]);
        let sourceAddress = sourceKeyPair?.address;
        console.log(
          `\nrow ${i} - transfer all funds/reap: ${sourceAddress} => ${destAddress}`
        );

        // check the account does not have any nfts.
        let nfts = await api.query.nfts.account.keys(sourceAddress);
        if (nfts.length !== 0) {
          console.log(
            notificationMessage(
              `${sourceAddress} has ${nfts.length} NFTs. Can not be reaped.`
            )
          );
          continue;
        }

        // check if account has any balances
        // retrieve the balance, once-off at the latest block
        const {
          data: { free },
        } = (await api.query.system.account(sourceAddress)).toJSON();
        console.log(`free balance to claim: ${free}`);
        if (free === 0) {
          console.log(
            notificationMessage(
              `${sourceAddress} has no free balance to transfer.`
            )
          );
          continue;
        }
        let tx = api.tx.balances.transferAll(destAddress, false);
        txs.push(signAndSendTx(api, tx, sourceKeyPair, false, dryRun));
      }
    }
    console.log(
      `claiming funds from ${txs.length} addresses in batch# ${batchNo} ...`
    );
    if (txs.length > 0) {
      await Promise.all(txs);
    }
  };

  await executeInBatch(batchInfo, batchAction, () => {});
};

const burnUnclaimedInBatch = async (wfConfig) => {
  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

  const { api } = context.network;

  // read collectionId from checkpoint
  if (context.collection.id === undefined) {
    throw new WorkflowError(
      'No collectionId is loaded in context. Either the collectionId is not specified in the workflow file or the checkpoint is not in correct state.'
    );
  }
  let collectionId = context.collection.id;
  let [addressColumn] = context.data.getColumns([columnTitles.address]);
  if (
    !addressColumn.records?.[startRecordNo] ||
    !addressColumn.records?.[endRecordNo - 1]
  ) {
    throw new WorkflowError(
      'No address column is recorded in the workflow or the checkpoint is not in a correct state.'
    );
  }

  // load last minted batch from checkpoint
  let batchSize = parseInt(wfConfig?.item?.batchSize) || 100;
  let ownerAddresses = addressColumn.records;

  let batchInfo = {
    startRecordNo,
    endRecordNo,
    checkpointedBatchNo: 0,
    batchSize,
  };

  let batchAction = async (batchStartRecordNo, batchEndRecordNo, batchNo) => {
    let batchOwnerAddresses = ownerAddresses.slice(
      batchStartRecordNo,
      batchEndRecordNo
    );

    let unclaimed = await Promise.all(
      batchOwnerAddresses.map((addr) =>
        api.query.nfts.account.keys(addr, collectionId)
      )
    );
    let unclaimedItems = [];
    for (let acountAssets of unclaimed) {
      acountAssets.forEach((key, i) => {
        let [address, collectionId, itemId] = key.args;
        unclaimedItems.push(itemId);
      });
    }

    if (unclaimedItems && unclaimedItems.length > 0) {
      await burnItems(context.network, collectionId, unclaimedItems, dryRun);
    }
  };

  await executeInBatch(batchInfo, batchAction, () => {});
};

const enableDryRun = async () => {
  const context = getContext();
  const { api } = context.network;

  // validate transactions
  if (!api.rpc.system.dryRun) {
    throw new WorkflowError('Dry-run mode is not supported on this network');
  }

  context.dryRun = true;
};

const verifyWorkflow = async (wfConfig) => {
  let initialFund = wfConfig?.item?.initialFund;

  const context = getContext();
  const { api } = context.network;
  const { startRecordNo, endRecordNo } = context.data;

  // validate initial fund if user set it manually
  if (initialFund && initialFund.match(initialFundPattern)) {
    const { existentialDeposit } = api.consts.balances;

    if (existentialDeposit.gt(new BN(initialFund))) {
      throw new WorkflowError(
        `item.initialFund should be bigger than existential deposit (${existentialDeposit.toNumber()})`
      );
    }
  }

  // check image files
  const itemMetadata = wfConfig?.item?.metadata;
  if (!isEmptyObject(itemMetadata)) {
    const {
      imageFolder,
      imageFileNameTemplate,
      videoFolder,
      videoFileNameTemplate,
    } = itemMetadata;

    for (let i = startRecordNo; i < endRecordNo; i++) {
      if (!context.data.records[i]) continue;

      if (imageFileNameTemplate) {
        const imageFileName = formatFileName(imageFileNameTemplate, i + 2, {
          header: context.data.header,
          records: context.data.records[i],
        });
        const imageFile = path.join(imageFolder, imageFileName);

        if (!fs.existsSync(imageFile)) {
          throw new WorkflowError(
            `imageFile: ${imageFile} does not exist to be minted for row: ${
              i + 2
            }`
          );
        }
      }

      if (videoFileNameTemplate) {
        const videoFileName = formatFileName(videoFileNameTemplate, i + 2, {
          header: context.data.header,
          records: context.data.records[i],
        });
        const videoFile = path.join(videoFolder, videoFileName);

        if (!fs.existsSync(videoFile)) {
          throw new WorkflowError(
            `videoFile: ${videoFile} does not exist to be minted for row: ${
              i + 2
            }`
          );
        }
      }
    }
  }
};

const calcMinInitialFund = async () => {
  const context = getContext();
  const { api, signingPair } = context.network;

  let collectionId = 1;
  let itemId = 1;
  // calculate minimum initial fund
  const destinationAddress = '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY'; // Alice's address
  const { existentialDeposit } = api.consts.balances;
  const info = await api.tx.nfts
    .transfer(collectionId, itemId || 0, destinationAddress)
    .paymentInfo(signingPair.address);
  // The actual fee will be more than the estimated partial fee after adding the actual weights.
  // to estimate the actual fee we consider fee=1.3*partialFee
  const fee = info.partialFee.muln(FEE_ADJUSTMENT_MULTIPLIER).divn(100);

  // set the min initial fund equal to existentialDeposit + fees.
  // The fee is needed to cover the tx fee for transferring the NFT from temp gift account to the final account
  const minInitialFund = existentialDeposit.add(fee.muln(2));
  return minInitialFund;
};

const calculateCost = async (wfConfig) => {
  const context = getContext();
  const { api } = context.network;

  let metadataDepositBase = api.consts.nfts.metadataDepositBase;
  let depositPerByte = api.consts.nfts.depositPerByte;
  let metadataDeposit = metadataDepositBase.add(
    depositPerByte.muln(METADATA_SIZE)
  );
  let collectionDeposit = api.consts.nfts.collectionDeposit;
  let itemDeposit = api.consts.nfts.itemDeposit;
  let metadataCount = 0;
  let itemCount = 0;
  let collectionCount = 0;
  itemCount = context.data.endRecordNo - context.data.startRecordNo;

  if (!context.collection.isExistingCollection) {
    // a new collection must be created.
    collectionCount = 1;
  }
  if (wfConfig['collection']['metadata']) {
    metadataCount += 1;
  }
  if (wfConfig['item']['metadata']) {
    metadataCount +=
      itemCount - context.batch.lastMetadataBatch * wfConfig.item.batchSize;
  }

  let minInitialFund = await calcMinInitialFund();
  let totalCollectionDeposit = collectionDeposit.muln(collectionCount);
  let totalInitialFunds = minInitialFund.muln(
    itemCount - context.batch.lastBalanceTxBatch * wfConfig.item.batchSize
  );
  let totalItemDeposit = itemDeposit.muln(itemCount);
  let totalMetadataDeposit = metadataDeposit.muln(metadataCount);
  return {
    totalInitialFunds,
    totalCollectionDeposit,
    totalMetadataDeposit,
    totalItemDeposit,
  };
};

const runWorkflow = async (configFile = './src/workflow.json', dryRunMode) => {
  if (dryRunMode) console.log(importantMessage('\ndry-run mode is on'));

  console.log('> loading the workflow config ...');
  let { error, config } = parseConfig(configFile);

  if (error) {
    throw new WorkflowError(error);
  }
  console.log('> setting the context for the workflow ...');

  await checkPreviousCheckpoints();
  await loadContext(config);
  let context = getContext();
  let { api, signingPair, chainInfo } = context.network;

  // 0 - run various checks
  await verifyWorkflow(config);

  // calculate the workflow cost
  let {
    totalInitialFunds,
    totalCollectionDeposit,
    totalItemDeposit,
    totalMetadataDeposit,
  } = await calculateCost(config);

  let totalCost = totalInitialFunds
    .add(totalCollectionDeposit)
    .add(totalItemDeposit)
    .add(totalMetadataDeposit);

  let initalFundsStr = formatBalanceWithUnit(totalInitialFunds, chainInfo);
  let collectionDepositStr = formatBalanceWithUnit(
    totalCollectionDeposit,
    chainInfo
  );
  let itemsDepositStr = formatBalanceWithUnit(totalItemDeposit, chainInfo);
  let metadataDepositStr = formatBalanceWithUnit(
    totalMetadataDeposit,
    chainInfo
  );
  let totalCostStr = formatBalanceWithUnit(totalCost, chainInfo);

  // check the minting account has enough funds to mint the workflow.
  let adminAddress = signingPair.address;
  let { data: balance } = await api.query.system.account(adminAddress);
  let usableBalance = balance.free.gte(balance.frozen)
    ? balance.free.sub(balance.frozen)
    : new BN(0);
  let usableBalanceStr = formatBalanceWithUnit(usableBalance, chainInfo);

  console.info(
    `\
    \nThe cost of running the remaining workflow is : \
    \ncollection deposit: ${collectionDepositStr} \
    \nitems deposit: ${itemsDepositStr} \
    \nmetadata deposit: ${metadataDepositStr} \
    \ninitial funds: ${initalFundsStr} \
    \n----------------------------- \
    \ntotal cost: ${totalCostStr} \
    \nAccount Balance: ${usableBalanceStr} \
    \n \
    `
  );

  if (totalCost.gt(usableBalance)) {
    console.info(
      notificationMessage(
        `The account does not have enough funds to cover the cost of running the workflow.\
        \nThe workflow might stop at any step once your available balance is consumed.
        `
      )
    );

    let message = `Would you like to continue the workflow without enough funds?`;
    const { continueWithoutFunds } = (await inqAsk([
      {
        type: 'confirm',
        name: 'continueWithoutFunds',
        message,
        default: false,
      },
    ])) || { continueWithoutFunds: false };

    if (!continueWithoutFunds) {
      return;
    }
  }

  if (dryRunMode) {
    // TODO: uncomment once we find a true way to detect that method on rpc nodes
    // await enableDryRun();

    // temporary code
    console.info(importantMessage('\ndry-run check successfully finished'));
    context.clean();
    return;
  }

  // 1 - create collection
  console.info(stepTitle`\n\nCreating the nfts collection ...`);
  await createCollection(config);

  // 2 - set collection's metadata
  console.info(stepTitle`\n\nSetting collection metadata ...`);
  await setCollectionMetadata(config);

  // 3 - generate secrets
  console.info(stepTitle`\n\nGenerating gift secrets ...`);
  await generateGiftSecrets(config);

  // 4 - mint items in batch
  console.info(stepTitle`\n\nMinting nft items ...`);
  await mintItemsInBatch(config);

  // 5 - pin images and generate metadata
  console.info(stepTitle`\n\nUploading and pinning the NFTs on IPFS ...`);
  await pinAndSetImageCid(config);

  // 6 - set metadata for items
  console.info(stepTitle`\n\nSetting the item metadata on chain ...`);
  await setItemsMetadata(config);

  // 7 - fund gift accounts with the initialFund amount.
  console.info(stepTitle`\n\nSeeding the accounts with initial funds ...`);
  await sendInitialFunds(config);

  if (!dryRunMode) {
    // move the final data file to the output path, cleanup the checkpoint files.
    let outFilename = config?.item?.data?.outputCsvFile;
    context.data.writeFinalResult(outFilename);
    console.info(
      importantMessage(`\n\nThe final datafile is copied at \n ${outFilename}`)
    );
  }

  // cleanup the workspace, remove checkpoint files
  context.clean();
};

const updateMetadata = async (
  configFile = './src/workflow.json',
  dryRunMode
) => {
  if (dryRunMode) console.log(importantMessage('\ndry-run mode is on'));

  console.log('> loading the workflow config ...');
  let { error, config } = parseConfig(configFile);

  if (error) {
    throw new WorkflowError(error);
  }
  console.log('> setting the context for the update metadata workflow ...');

  await checkPreviousCheckpoints();
  await loadContext(config);
  let context = getContext();

  // 0 - run various checks
  await verifyWorkflow(config);

  if (dryRunMode) {
    // TODO: uncomment once we find a true way to detect that method on rpc nodes
    // await enableDryRun();

    // temporary code
    console.log(importantMessage('\ndry-run check successfully finished'));
    context.clean();
    return;
  }

  // 1 - skip collection creation
  // since we're just updating the metadata, the collection should already exist, otherwise the update must fail

  // load collectionId from config:
  context.collection.id = config.collection.id;

  // 2 - set collectionMetadata
  console.info(stepTitle`\n\nSetting collection metadata ...`);
  await setCollectionMetadata(config);

  // 3 - pin images and generate metadata
  console.info(stepTitle`\n\nUploading and pinning the NFTs on IPFS ...`);
  await pinAndSetImageCid(config);

  // 4 - set metadata for items
  console.info(stepTitle`\n\nSetting items metadata on chain ...`);
  await setItemsMetadata(config);

  if (!dryRunMode) {
    // move the final data file to the output path, cleanup the checkpoint files.
    let outFilename = config?.item?.data?.outputCsvFile;
    context.data.writeFinalResult(outFilename);
    console.info(
      importantMessage(`\n\nThe final datafile is copied at \n ${outFilename}`)
    );
  }

  // cleanup the workspace, remove checkpoint files
  context.clean();
};

const renameFolderContent = (srcDir, targetExt, startIdx) => {
  if (!fs.existsSync(srcDir)) {
    throw new Error('The input directory path does bot exist!');
  }
  let fileno = startIdx;
  let files = fs.readdirSync(srcDir);
  files.forEach((filename) => {
    let parts = filename.split('.');
    let ext = parts.length > 1 ? parts.pop() : undefined;
    if (!targetExt || ext === targetExt) {
      let newFileName = ext ? `${fileno}.${ext}` : `${fileno}`;
      let fromName = path.join(srcDir, filename);
      let toName = path.join(srcDir, newFileName);
      fs.rename(fromName, toName, (err) => {
        throw err;
      });
      fileno += 1;
    }
  });
};

const burnAndReap = async (configFile = './src/workflow.json', dryRunMode) => {
  if (dryRunMode) console.log(importantMessage('\ndry-run mode is on'));

  console.log('> loading the workflow config ...');
  let { error, config } = parseConfig(configFile);

  if (error) {
    throw new WorkflowError(error);
  }
  console.log('> setting the context for the update metadata workflow ...');

  await checkPreviousCheckpoints();
  console.log('1');
  await loadContext(config);
  let context = getContext();

  // 0- run various checks
  await verifyWorkflow(config);

  if (dryRunMode) {
    // TODO: uncomment once we find a true way to detect that method on rpc nodes
    // await enableDryRun();

    // temporary code
    console.log(importantMessage('\ndry-run check successfully finished'));
    context.clean();
    return;
  }

  // 1- skip create collection
  // since we want to burn and reap accounts we assume the collection in the workflow is already created otherwise it will throw error.
  // load collectionId from config:
  context.collection.id = config.collection.id;

  // 2- burn unclaimed items
  console.info(stepTitle`\n\nBurning unclaimed items ...`);
  await burnUnclaimedInBatch(config);

  //3- reap the unclimed secrets and return their fund to the signingAccount
  console.info(
    stepTitle`\n\nReclaiming the funds from the unclaimed secrets... `
  );
  await reapUnusedFunds(config);

  if (!dryRunMode) {
    // move the final data file to the output path, cleanup the checkpoint files.
    let outFilename = config?.item?.data?.outputCsvFile;
    context.data.writeFinalResult(outFilename);
    console.info(
      importantMessage(`\n\nThe final datafile is copied at \n ${outFilename}`)
    );
  }

  // cleanup the workspace, remove checkpoint files
  context.clean();
};

module.exports = {
  runWorkflow,
  updateMetadata,
  renameFolderContent,
  burnAndReap,
};
