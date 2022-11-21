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
const { mintClassInstances, burnInstances } = require('./mint');
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
const { isNumber, isEmptyObject } = require('../utils');
const {
  importantMessage,
  stepTitle,
  notificationMessage,
} = require('../utils/styles');

const initialFundPattern = new RegExp('[1-9][0-9]*');
const METADATA_SIZE = 46;

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

const createClass = async (wfConfig) => {
  // 1- create class if do not exists
  const context = getContext();
  const { api, signingPair, proxiedAddress } = context.network;
  const { dryRun } = context;

  if (context.class.id === undefined) {
    throw new WorkflowError(
      'No class.id checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  if (!context.class.isExistingClass) {
    // create the new class
    let tx = api.tx.uniques.create(context.class.id, signingPair?.address);
    let call = proxiedAddress
      ? api.tx.proxy.proxy(proxiedAddress, 'Assets', tx)
      : tx;
    await signAndSendTx(api, call, signingPair, true, dryRun);
  }
  // set the class checkpoint
  if (!dryRun) context.class.checkpoint();
};

const setCollectionMetadata = async (wfConfig) => {
  // 2-generate/set class metadata
  const context = getContext();
  const { dryRun } = context;

  if (context.class.id === undefined) {
    throw new WorkflowError(
      'No class.id checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  if (!context.class.metaCid) {
    // no class metadata is recorded in the checkpoint
    let metadata = wfConfig?.class?.metadata;
    if (!metadata) {
      // no class metadata is configured. ask user if they want to configure a class metadata
      let { withoutMetadata } = (await inqAsk([
        {
          type: 'confirm',
          name: 'withoutMetadata',
          message: `No class metadata is configured in workflow.json, do you want to continue without setting class metadata`,
          default: false,
        },
      ])) || { withoutMetadata: false };
      if (!withoutMetadata) {
        throw new WorkflowError(
          'Please configure a class metadata in workflow.json.'
        );
      }
    } else {
      let metadataFolder = wfConfig.metadataFolder;
      let metadataFile = path.join(metadataFolder, 'class.meta');
      context.class.metaCid = await generateAndSetCollectionMetadata(
        context.network,
        context.pinataClient,
        context.class.id,
        metadata,
        metadataFile
      );
      // update class checkpoint
      if (!dryRun) context.class.checkpoint();
    }
  } else {
    console.log(
      notificationMessage('Re-using class metadata from the checkpoint')
    );
  }
};

const generateGiftSecrets = async (wfConfig) => {
  // 3-create nft secrets + addresses
  let context = getContext();
  const { dryRun } = context;
  let keyring = context.network.keyring;
  // TODO: check if instanceOffset + instanceCount is out of bound (> data.length) throw an error
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

const mintInstancesInBatch = async (wfConfig) => {
  //4- mint instances in batch
  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

  // read classId from checkpoint
  if (context.class.id === undefined) {
    throw new WorkflowError(
      'No classId checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  let [addressColumn, instanceIdColumn] = context.data.getColumns([
    columnTitles.address,
    columnTitles.instanceId,
  ]);
  // add instanceId column if not exists
  if (instanceIdColumn.records.length === 0) {
    context.data.addColumn(columnTitles.instanceId);
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

  // if class already has instances, start from the first available id to mint new instances.
  let startInstanceId = isNumber(context?.class?.startInstanceId)
    ? parseInt(context?.class?.startInstanceId)
    : 0;

  // load last minted batch from checkpoint
  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;
  let lastCheckpointedBatch = context.batch.lastMintBatch;

  let batchInfo = {
    startRecordNo,
    endRecordNo,
    checkpointedBatchNo: lastCheckpointedBatch,
    batchSize,
  };

  let batchAction = async (batchStartRecordNo, batchEndRecordNo, batchNo) => {
    let batchStartInstanceId = startInstanceId + (batchNo - 1) * batchSize;
    let ownerAddresses = addressColumn.records;
    await mintClassInstances(
      context.network,
      context.class.id,
      batchStartInstanceId,
      ownerAddresses.slice(batchStartRecordNo, batchEndRecordNo),
      dryRun
    );

    let currentInstanceId = startInstanceId + (batchNo - 1) * batchSize;
    for (let i = batchStartRecordNo; i < batchEndRecordNo; i++) {
      instanceIdColumn.records[i] = currentInstanceId;
      currentInstanceId += 1;
    }
    context.data.setColumns([instanceIdColumn]);
  };

  let batchCheckpointCb = async (
    batchStartRecordNo,
    batchEndRecordNo,
    batchNo
  ) => {
    if (!dryRun) {
      // set checkpoint for instanceIds
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
  // 5- pin images and generate metadata
  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

  // set the metadata for instances in batch
  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;
  let lastCheckpointedBatch = context.batch.lastMetaCidBatch || 0;

  const rowNumber = (zerobasedIdx) => zerobasedIdx + 2;
  const instanceMetadata = wfConfig?.instance?.metadata;
  if (isEmptyObject(instanceMetadata)) {
    return;
  }
  const {
    name,
    description,
    imageFolder,
    imageFileNameTemplate,
    videoFolder,
    videoFileNameTemplate,
  } = instanceMetadata;

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
      const instanceName = fillTemplateFromData(
        name,
        context.data.header,
        context.data.records[i]
      );

      // fill template description to build the description string
      const instanceDescription = fillTemplateFromData(
        description,
        context.data.header,
        context.data.records[i]
      );

      let metadataName = `row-${rowNumber(i)}.meta`;
      let metadataFolder = wfConfig.metadataFolder;
      let metaPath = path.join(metadataFolder, metadataName);
      const { metaCid, imageCid, videoCid } = await generateMetadata(
        context.pinataClient,
        instanceName,
        instanceDescription,
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

const setInstanceMetadata = async (wfConfig) => {
  // 6- set metadata for instances
  const instanceMetadata = wfConfig?.instance?.metadata;
  if (isEmptyObject(instanceMetadata)) {
    console.log(
      notificationMessage(
        'Skipped! No instance metadata is configured for the workflow'
      )
    );
    return;
  }

  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;
  let lastCheckpointedBatch = context.batch.lastMetadataBatch || 0;

  // read classId from checkpoint
  if (context.class.id === undefined) {
    throw new WorkflowError(
      'No classId checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  const [metaCidColumn, instanceIdColumn] = context.data.getColumns([
    columnTitles.metaCid,
    columnTitles.instanceId,
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
    !isNumber(instanceIdColumn?.records?.[startRecordNo]) ||
    !isNumber(instanceIdColumn?.records?.[endRecordNo - 1])
  ) {
    throw new WorkflowError(
      'No instanceId is recorded or the checkpoint is not in a correct state.'
    );
  }

  let batchInfo = {
    startRecordNo,
    endRecordNo,
    checkpointedBatchNo: lastCheckpointedBatch,
    batchSize,
  };

  const batchAction = async (batchStartRecordNo, batchEndRecordNo, _) => {
    let instanceMetadatas = [];
    // iterate the rows from startRecordNo to endRecordNo and collect recorded metadata info
    for (let i = batchStartRecordNo; i < batchEndRecordNo; i++) {
      if (!isNumber(instanceIdColumn.records?.[i])) {
        throw new WorkflowError(
          `No instanceId is recorded for row#: ${i} or the checkpoint is not in a correct state.`
        );
      }
      const metadata = {
        instanceId: instanceIdColumn.records[i],
        metaCid: metaCidColumn.records[i],
      };
      instanceMetadatas.push(metadata);
    }

    await setMetadataInBatch(
      context.network,
      context.class.id,
      instanceMetadatas,
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
  let initialFund = wfConfig?.instance?.initialFund;

  const context = getContext();
  const { dryRun } = context;
  const { startRecordNo, endRecordNo } = context.data;
  const { api, signingPair } = context.network;

  // calculate minimum initial fund
  const minInitialFund = await calcMinInitialFund();

  // check the value of  the configured initialFund is valid and above the minimum needed funds to claim
  if (
    !initialFund?.match(initialFundPattern) ||
    minInitialFund.lte(new BN(initialFund))
  ) {
    let message = `Each gift account needs to have a minimum balance of ${minInitialFund.toString()} to cover the claim fee.\nYou have not configured any initialFunds or the configured value is below minimum required amount.\nWould you like to calculate and set the initialFund to ${minInitialFund.toString()}?.`;
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
  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;
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
  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;

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
        let nfts = await api.query.uniques.account.keys(sourceAddress);
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

  // read classId from checkpoint
  if (context.class.id === undefined) {
    throw new WorkflowError(
      'No classId is loaded in context. Either the classId is not specified in the workflow file or the checkpoint is not in correct state.'
    );
  }
  let classId = context.class.id;
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
  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;
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
        api.query.uniques.account.keys(addr, classId)
      )
    );
    let unclaimedInstances = [];
    for (let acountAssets of unclaimed) {
      acountAssets.forEach((key, i) => {
        let [address, classId, instanceId] = key.args;
        unclaimedInstances.push(instanceId);
      });
    }

    if (unclaimedInstances && unclaimedInstances.length > 0) {
      await burnInstances(context.network, classId, unclaimedInstances, dryRun);
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
  let initialFund = wfConfig?.instance?.initialFund;

  const context = getContext();
  const { api } = context.network;
  const { startRecordNo, endRecordNo } = context.data;

  // validate initial fund if user set it manually
  if (initialFund && initialFund.match(initialFundPattern)) {
    const { existentialDeposit } = api.consts.balances;

    if (existentialDeposit.gt(new BN(initialFund))) {
      throw new WorkflowError(
        `instance.initialFund should be bigger than existential deposit (${existentialDeposit.toNumber()})`
      );
    }
  }

  // check image files
  const instanceMetadata = wfConfig?.instance?.metadata;
  if (!isEmptyObject(instanceMetadata)) {
    const {
      imageFolder,
      imageFileNameTemplate,
      videoFolder,
      videoFileNameTemplate,
    } = instanceMetadata;

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

  // calculate minimum initial fund
  const { id: collectionId, startInstanceId: itemId } = context.class;
  const [destinationAddressColumn] = context.data.getColumns([
    columnTitles.address,
  ]);
  const destinationAddress = destinationAddressColumn.records[0];
  const { existentialDeposit } = api.consts.balances;
  const info = await api.tx.uniques
    .transfer(collectionId, itemId || 0, destinationAddress)
    .paymentInfo(signingPair.address);

  const fee = info.partialFee.muln(13).divn(10);

  // set the min initial fund equal to existentialDeposit + fees.
  // The fee is needed to cover the tx fee for transferring the NFT from temp gift account to the final account
  const minInitialFund = existentialDeposit.add(fee.muln(2));
  return minInitialFund;
};

const calculateCost = async (wfConfig) => {
  const context = getContext();
  const { api } = context.network;

  let metadataDepositBase = api.consts.uniques.metadataDepositBase;
  let depositPerByte = api.consts.uniques.depositPerByte;
  let metadataDeposit = metadataDepositBase.add(
    depositPerByte.muln(METADATA_SIZE)
  );
  let collectionDeposit = api.consts.uniques.collectionDeposit;
  let itemDeposit = api.consts.uniques.itemDeposit;
  let metadataCount = 0;
  let itemCount = 0;
  let collectionCount = 0;
  itemCount = context.data.endRecordNo - context.data.startRecordNo;

  if (context.class.isExistingClass) {
    collectionCount = 1;
  }
  if (wfConfig['class']['metadata']) {
    metadataCount += 1;
  }
  if (wfConfig['instance']['metadata']) {
    metadataCount +=
      itemCount - context.batch.lastMetadataBatch * wfConfig.instance.batchSize;
  }

  let minInitialFund = await calcMinInitialFund();
  let totalCollectionDeposit = collectionDeposit.muln(collectionCount);
  let totalInitialFunds = minInitialFund.muln(
    itemCount - context.batch.lastBalanceTxBatch * wfConfig.instance.batchSize
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
  let { api, signingPair } = context.network;

  // 0- run various checks
  await verifyWorkflow(config);

  // calculate the workflow cost
  let {
    totalInitialFunds,
    totalCollectionDeposit,
    totalItemDeposit,
    totalMetadataDeposit,
  } = await calculateCost(config);
  console.log(
    totalInitialFunds,
    totalCollectionDeposit,
    totalItemDeposit,
    totalMetadataDeposit
  );
  let totalCost = totalInitialFunds
    .add(totalCollectionDeposit)
    .add(totalItemDeposit)
    .add(totalMetadataDeposit);
  console.info(`total cost of minting the workflow is : ${totalCost}`);
  let adminAddress = signingPair.address;
  let { data: balance } = await api.query.system.account(adminAddress);
  let usableBalance = balance.free.gte(balance.miscFrozen)
    ? balance.free.sub(balance.miscFrozen)
    : new BN(0);
  if (totalCost.gt(usableBalance)) {
    console.log(`the account that is used for minting does not have enough funds to cover the cost of running the workflow.
    Account Balance:${usableBalance}\n
    Total Cost:${totalCost}`);
  }
  // check the minting account has enough funds to mint the workflow.

  if (dryRunMode) {
    // TODO: uncomment once we find a true way to detect that method on rpc nodes
    // await enableDryRun();

    // temporary code
    console.info(importantMessage('\ndry-run check successfully finished'));
    context.clean();
    return;
  }

  // 1- create class
  console.info(stepTitle`\n\nCreating the uniques class ...`);
  await createClass(config);

  // 2- set classMetadata
  console.info(stepTitle`\n\nSetting class metadata ...`);
  await setCollectionMetadata(config);

  // 3- generate secrets
  console.info(stepTitle`\n\nGenerating gift secrets ...`);
  await generateGiftSecrets(config);

  //4- mint instances in batch
  console.info(stepTitle`\n\nMinting nft instances ...`);
  await mintInstancesInBatch(config);

  //5- pin images and generate metadata
  console.info(stepTitle`\n\nUploading and pinning the NFTs on IPFS ...`);
  await pinAndSetImageCid(config);

  //6- set metadata for instances
  console.info(stepTitle`\n\nSetting the instance metadata on chain ...`);
  await setInstanceMetadata(config);

  //7-fund gift accounts with the initialFund amount.
  console.info(stepTitle`\n\nSeeding the accounts with initial funds ...`);
  await sendInitialFunds(config);

  if (!dryRunMode) {
    // move the final data file to the output path, cleanup the checkpoint files.
    let outFilename = config?.instance?.data?.outputCsvFile;
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

  // 1- skip create class
  // since we just updating the metadata the class should already exists otherwise the update must fail
  // load classId from config:
  context.class.id = config.class.id;

  // 2- set classMetadata
  console.info(stepTitle`\n\nSetting class metadata ...`);
  await setCollectionMetadata(config);

  //3- pin images and generate metadata
  console.info(stepTitle`\n\nUploading and pinning the NFTs on IPFS ...`);
  await pinAndSetImageCid(config);

  //4- set metadata for instances
  console.info(stepTitle`\n\nSetting the instance metadata on chain ...`);
  await setInstanceMetadata(config);

  if (!dryRunMode) {
    // move the final data file to the output path, cleanup the checkpoint files.
    let outFilename = config?.instance?.data?.outputCsvFile;
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

  // 1- skip create class
  // since we want to burn and reap accounts we assume the class in the workflow is already created otherwise it will throw error.
  // load classId from config:
  context.class.id = config.class.id;

  // 2- burn unclaimed instances
  console.info(stepTitle`\n\nBurning unclaimed instances ...`);
  await burnUnclaimedInBatch(config);

  //3- reap the unclimed secrets and return their fund to the signingAccount
  console.info(
    stepTitle`\n\nReclaiming the funds from the unclaimed secrets... `
  );
  await reapUnusedFunds(config);

  if (!dryRunMode) {
    // move the final data file to the output path, cleanup the checkpoint files.
    let outFilename = config?.instance?.data?.outputCsvFile;
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
