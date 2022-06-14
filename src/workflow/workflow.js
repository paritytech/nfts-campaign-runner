const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const BN = require('bn.js');

const {
  generateAndSetClassMetadata,
  generateMetadata,
  setMetadataInBatch,
} = require('./metadata');
const { generateSecret } = require('./giftSecrets');
const { mintClassInstances } = require('./mint');
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
  systemMessage,
} = require('../utils/styles');

const createClass = async (wfConfig) => {
  // 1- create class
  const context = getContext();
  const { api, signingPair, proxiedAddress } = context.network;
  const { dryRun } = context;

  // if a valid class is not already created or does not exist, create the class
  if (
    context.class.id === undefined ||
    wfConfig.class?.id !== context.class.id
  ) {
    // check the specified class does not exist
    let cfgClassId = wfConfig.class.id;
    let uniquesClass = (await api.query.uniques.class(cfgClassId))
      ?.unwrapOr(undefined)
      ?.toHuman();

    if (uniquesClass) {
      // class already exists ask user if they want to mint in the same class
      const answer = (await inqAsk([
        {
          type: 'confirm',
          name: 'appendToClass',
          message: `A class with classId:${cfgClassId} already exists, do you want to create the instances in the same class?`,
          default: false,
        },
      ])) || { appendToClass: false };
      if (!answer?.appendToClass) {
        throw new WorkflowError(
          'Please set a different class id in your workflow.json settings.'
        );
      } else {
        context.class.id = cfgClassId;
        // set the start instance id to the last id available in the class assuming all instances are minted from 0 to number of current instances.
        console.log(
          systemMessage(
            `The class ${cfgClassId} exists. The new items will be added to the class staring from index ${uniquesClass?.instances}.`
          )
        );
        context.class.startInstanceId = Number(uniquesClass?.instances);
      }
    } else {
      // create a new class
      context.class.id = cfgClassId;
      let tx = api.tx.uniques.create(context.class.id, signingPair?.address);
      let call = proxiedAddress
        ? api.tx.proxy.proxy(proxiedAddress, 'Assets', tx)
        : tx;
      await signAndSendTx(api, call, signingPair, true, dryRun);
    }
    // set the class checkpoint
    if (!dryRun) context.class.checkpoint();
  } else {
    console.log(
      systemMessage('Class information loaded from the checkpoint file')
    );
  }
};

const setClassMetadata = async (wfConfig) => {
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
      context.class.metaCid = await generateAndSetClassMetadata(
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
    console.log(systemMessage('Re-using class metadata from the checkpoint'));
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

  let [addressColumn] = context.data.getColumns([columnTitles.address]);
  if (
    !addressColumn.records?.[startRecordNo] ||
    !addressColumn.records?.[endRecordNo - 1]
  ) {
    throw new WorkflowError(
      'No address checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  // if class already has instances in it start from the first available id to mint new instances.
  let startInstanceId = isNumber(context?.class?.startInstanceId)
    ? parseInt(context?.class?.startInstanceId)
    : 0;

  // load last minted batch from checkpoint
  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;
  let lastBatch = context.batch.lastMintBatch;

  if (lastBatch) {
    console.log(systemMessage('Checkpoint data spotted'));

    if (startRecordNo + lastBatch * batchSize < endRecordNo) {
      console.log(systemMessage(`Continuing from batch #${lastBatch}\n\n`));
    } else {
      console.log(importantMessage('Nothing left to mint'));
    }
  }

  let ownerAddresses = addressColumn.records;
  while (startRecordNo + lastBatch * batchSize < endRecordNo) {
    console.log(`Sending batch number ${lastBatch + 1}`);
    let batchStartInstanceId = startInstanceId + lastBatch * batchSize;
    let batchStartRecordNo = startRecordNo + lastBatch * batchSize;
    let batchEndRecordNo = Math.min(
      startRecordNo + (lastBatch + 1) * batchSize,
      endRecordNo
    );
    await mintClassInstances(
      context.network,
      context.class.id,
      batchStartInstanceId,
      ownerAddresses.slice(batchStartRecordNo, batchEndRecordNo),
      dryRun
    );

    lastBatch += 1;
    console.log(`Batch number ${lastBatch} was minted successfully`);
    context.batch.lastMintBatch = lastBatch;
    if (!dryRun) context.batch.checkpoint();
  }

  // all instances are minted. set the instanceId for each record in data checkpoint.
  let currentInstanceId = startInstanceId;
  let instanceIdColumn = { title: columnTitles.instanceId, records: [] };
  for (let i = 0; i <= context.data.records.length; i++) {
    if (i > instanceIdColumn.records.length) {
      instanceIdColumn.records.push('');
    }
    if (i >= startRecordNo && i < endRecordNo) {
      instanceIdColumn.records[i] = currentInstanceId;
      currentInstanceId += 1;
    }
  }
  context.data.setColumns([instanceIdColumn]);
  if (!dryRun) context.data.checkpoint();
};

const formatFileName = (fileNameTemplate, rowNumber, { header, records }) => {
  if (fileNameTemplate.includes('<>')) {
    return fileNameTemplate.replace('<>', rowNumber);
  }

  return fillTemplateFromData(fileNameTemplate, header, records);
};

const pinAndSetImageCid = async (wfConfig) => {
  // 5- pin images and generate metadata
  let context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;
  const rowNumber = (zerobasedIdx) => zerobasedIdx + 2;
  const instanceMetadata = wfConfig?.instance?.metadata;
  if (isEmptyObject(instanceMetadata)) return;
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
  let itemsGenerated = 0;
  let totalItems = 0;
  for (let i = 0; i < context.data.records.length; i++) {
    if (i >= imageCidColumn.records.length) {
      imageCidColumn.records.push('');
    }
    if (i >= videoCidColumn.records.length) {
      videoCidColumn.records.push('');
    }
    if (i >= metaCidColumn.records.length) {
      metaCidColumn.records.push('');
    }

    if (i >= startRecordNo && i < endRecordNo) {
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
  }
  if (itemsGenerated) {
    context.data.setColumns([imageCidColumn, metaCidColumn, videoCidColumn]);
    if (!dryRun) context.data.checkpoint();
    console.log(`${itemsGenerated} metadata(s) uploaded`);
  } else if (!totalItems) {
    console.log(importantMessage('No metadata was uploaded'));
  }
};

const setInstanceMetadata = async (wfConfig) => {
  // 6- set metadata for instances
  const instanceMetadata = wfConfig?.instance?.metadata;
  if (isEmptyObject(instanceMetadata)) {
    console.log(
      systemMessage(
        'Skipped! No instance metadata is configured for the workflow'
      )
    );
    return;
  }

  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

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

  // set the metadata for instances in batch
  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;
  let lastBatch = context.batch.lastMetadataBatch || 0;

  if (lastBatch) {
    console.log(systemMessage('Checkpoint data spotted'));

    if (startRecordNo + lastBatch * batchSize < endRecordNo) {
      console.log(systemMessage(`Continuing from batch #${lastBatch}\n\n`));
    } else {
      console.log(importantMessage('Nothing left to mint'));
    }
  }

  let instanceMetadatas = [];
  // iterate the rows from startRecordNo to endRecordNo and collect recorded metadata info
  for (let i = startRecordNo; i < endRecordNo; i++) {
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

  while (startRecordNo + lastBatch * batchSize < endRecordNo) {
    console.log(`Sending batch number ${lastBatch + 1}`);
    let batchStartRecordNo = startRecordNo + lastBatch * batchSize;
    let batchEndRecordNo = Math.min(
      startRecordNo + (lastBatch + 1) * batchSize,
      endRecordNo
    );

    await setMetadataInBatch(
      context.network,
      context.class.id,
      instanceMetadatas.slice(
        batchStartRecordNo - startRecordNo,
        batchEndRecordNo - startRecordNo
      ),
      dryRun
    );
    lastBatch += 1;
    console.log(`Batch number ${lastBatch} was minted successfully`);
    context.batch.lastMetadataBatch = lastBatch;
    if (!dryRun) context.batch.checkpoint();
  }
};

const sendInitialFunds = async (wfConfig) => {
  // 7-fund accounts with some initial funds
  const amount = wfConfig?.instance?.initialFund;

  // if no initialFund is set or initialFund is set to zero, skip this step.
  if (!amount) {
    console.log(
      'no initialFunds was set in workflow. skipping sendInitialFunds!'
    );
    return;
  }

  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  const { dryRun } = context;

  let [addressColumn] = context.data.getColumns([columnTitles.address]);
  if (
    !addressColumn.records?.[startRecordNo] ||
    !addressColumn.records?.[endRecordNo - 1]
  ) {
    throw new WorkflowError(
      'No address checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  // load last balanceTx batch from checkpoint
  let batchSize = parseInt(wfConfig?.instance?.batchSize) || 100;
  let lastBatch = context.batch.lastBalanceTxBatch;

  if (lastBatch) {
    console.log(systemMessage('Checkpoint data spotted'));

    if (startRecordNo + lastBatch * batchSize < endRecordNo) {
      console.log(systemMessage(`Continuing from batch #${lastBatch}\n\n`));
    } else {
      console.log(
        importantMessage('All the addresses were funded successfully')
      );
    }
  }

  let ownerAddresses = addressColumn.records;
  while (startRecordNo + lastBatch * batchSize < endRecordNo) {
    console.log(`Sending batch number ${lastBatch + 1}`);
    let batchStartRecordNo = startRecordNo + lastBatch * batchSize;
    let batchEndRecordNo = Math.min(
      startRecordNo + (lastBatch + 1) * batchSize,
      endRecordNo
    );
    await transferFunds(
      context.network,
      ownerAddresses.slice(batchStartRecordNo, batchEndRecordNo),
      amount,
      dryRun
    );

    lastBatch += 1;
    console.log(`Batch number ${lastBatch} was funded successfully`);
    context.batch.lastBalanceTxBatch = lastBatch;
    if (!dryRun) context.batch.checkpoint();
  }
};

const verifyWorkflow = async (wfConfig) => {
  const initialFund = wfConfig?.instance?.initialFund;

  const context = getContext();
  const { api } = context.network;
  const { startRecordNo, endRecordNo } = context.data;

  // validate initial fund
  if (initialFund) {
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

const enableDryRun = async () => {
  const context = getContext();
  const { api } = context.network;

  // validate transactions
  if (!api.rpc.system.dryRun) {
    throw new WorkflowError('Dry-run mode is not supported on this network');
  }

  context.dryRun = true;
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

  // 1- create class
  console.info(stepTitle`\n\nCreating the uniques class ...`);
  await createClass(config);

  // 2- set classMetadata
  console.info(stepTitle`\n\nSetting class metadata ...`);
  await setClassMetadata(config);

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
  await setClassMetadata(config);

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

module.exports = {
  runWorkflow,
  updateMetadata,
};
