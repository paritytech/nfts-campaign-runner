const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { writeCsvSync, readCsvSync, getColumnIndex } = require('./csv');
const {
  generateAndSetClassMetadata,
  generateMetadata,
  setMetadataInBatch,
} = require('./metadata');
const { generateSecret } = require('./giftSecrets');
const { mintClassInstances } = require('./mint');
const { columnTitles, getContext } = require('./checkpoint');

const { connect } = require('./chain/chain');
const wfSetting = require('./workflow.json');
const { signAndSendTx } = require('./chain/txHandler');

const inqAsk = inquirer.createPromptModule();

const createClass = async () => {
  // 1- create class
  const context = getContext();
  const { api, signingPair, proxiedAddress } = await connect();
  if (!wfSetting.class?.id) {
    throw new Error('No class id was found in workflow setting!');
  }

  // if a valid class is not already created or does not exist, create the class
  if (
    context.class.id == undefined ||
    wfSetting.class?.id != context.class.id
  ) {
    // check the specified class does not exist
    let cfgClassId = wfSetting.class?.id;
    let uniquesClass = await api.query.uniques.class(cfgClassId);
    if (uniquesClass?.isSome) {
      // class already exists ask user if they want to mint in the same class
      answer = (await inqAsk([
        {
          type: 'confirm',
          name: 'appendToClass',
          message: `A class with classId:${cfgClassId} already exists, do you want to create the instances in the same class?`,
          default: false,
        },
      ])) || { appendToClass: false };
      if (!answer?.appendToClass) {
        throw new Error(
          'Please set a different class name in your workflow.json settings.'
        );
      } else {
        context.class.id = cfgClassId;
      }
    } else {
      // create a new class
      context.class.id = cfgClassId;
      let tx = api.tx.uniques.create(classId, signingPair?.address);
      let call = proxiedAddress
        ? api.tx.proxy.proxy(proxiedAddress, 'Assets', tx)
        : tx;
      await signAndSendTx(api, call, signingPair);
    }
    // set the class checkpoint
    context.class.checkpoint();
  }
};

const setClassMetadata = async () => {
  // 2-generate/set class metadata
  const context = getContext();

  if (context.class.id == undefined) {
    throw new Error(
      'No class.id checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  if (!context.class.metaCid) {
    // no class metadata is recorded in the checkpoint
    let metadata = wfSetting?.class?.metadata;
    if (!metadata) {
      // no class metdata is configured. ask user if they want to configure a class metadata
      let { withoutMetadata } = (await inqAsk([
        {
          type: 'confirm',
          name: 'withoutMetadata',
          message: `No class metadata is configured in workflow.json, do you want to continue without setting class metadata`,
          default: false,
        },
      ])) || { withoutMetadata: false };
      if (!withoutMetadata) {
        throw new Error('Please configure a class metadata in workflow.json.');
      }
    } else {
      context.class.metaCid = await generateAndSetClassMetadata(
        context.class.id,
        metadata
      );
      // update class checkpoint
      context.class.checkpoint();
    }
  }
};

const generateGiftSecrets = async () => {
  // 3-create nft secrets + addresses
  let context = getContext();
  // ToDO: check if instanceOffset + instanceCount is out of cound (> dataRecords.length) throw an error
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
      const { secret, address } = await generateSecret();
      secretColumn.records[i] = secret;
      addressColumn.records[i] = address;
      isUpdated = true;
    }
  }
  if (isUpdated) {
    context.data.setColumns([secretColumn, addressColumn]);
    context.data.checkpoint();
  }
};

const mintInstancesInBatch = async () => {
  //4- mint instances in batch
  const { api, signingPair, proxiedAddress } = await connect();
  const context = getContext();
  const startRecordNo = context.data.startRecordNo;
  const endRecordNo = context.data.endRecordNo;

  // read classId from checkpoint
  if (context.class.id == undefined) {
    throw new Error(
      'No classId checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  let [addressColumn] = context.data.getColumns([columnTitles.address]);
  if (
    !addressColumn.records ||
    !addressColumn.records[startRecordNo] ||
    !addressColumn.records[endRecordNo - 1]
  ) {
    throw new Error(
      'No address checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  let { instances: startInstanceId } = await api.query.uniques.class(classId);

  // load last minted batch from checkpoint
  let batchSize = parseInt(wfSetting?.instance?.batchSize) || 100;
  let lastBatch = context.batch.lastMintBatch;

  let ownerAddresses = addressColumn.records;
  while (startRecordNo + lastBatch * batchSize < endRecordNo) {
    console.log(`Sending batch number ${lastBatch + 1}`);
    let batchStartInstanceId = startInstanceId + lastBatch * batchSize;
    let batchStartRecordNo = startRecordNo + lastBatch * batchSize;
    let batchEndRecordNo = Math.min(
      startRecordNo + (lastBatch + 1) * batchSize,
      endRecordNo
    );
    let events = await mintClassInstances(
      classId,
      batchStartInstanceId,
      ownerAddresses.slice(batchStartRecordNo, batchEndRecordNo)
    );

    lastBatch += 1;
    console.log(events);
    console.log(`Batch number ${lastBatch} was minted successfully`);
    context.batch.lastMintBatch = lastBatch;
    context.batch.checkpoint();
  }

  // all instances are minted. set the instanceId for each record in data checkpoint.
  let currentInstanceId = startInstanceId;
  let instanceIdColumn = { title: columnTitles.instanceId, records: [] };
  for (let i = 0; i <= context.data.records.length; i++) {
    if (i > instanceIdColumn.records.length) {
      instanceIdColumn.records.push('');
    }
    if (i >= startRecordNo && i < endRecordNo) {
      instanceIdColumn.records[i] = currentInstanceId + 1;
      currentInstanceId += 1;
    }
  }
  context.data.setColumns([instanceIdColumn]);
  context.data.checkpoint();
};

const pinAndSetImageCid = async () => {
  let context = getContext();
  const { startRecordNo, endRecordNo } = context.data;

  const { name, description, imageFolder, extension } =
    wfSetting?.instance?.metadata;
  if (!fs.existsSync(imageFolder)) {
    throw new Error(
      `The instance image folder :${imageFolder} does not exist!`
    );
  }
  for (let i = startRecordNo; i < endRecordNo; i++) {
    // check the image files exist
    let imageFile = path.join(imageFolder, `${i + 2}.${extension}`);
    if (!fs.existsSync(imageFile)) {
      // ToDo: instead of throwing ask if the user wants to continue by skipping minting for those rows
      throw new Error(
        `imageFile: ${imageFile} does not exist to be minted for row:${i + 2}`
      );
    }
  }

  const [imageCidColumn, metaCidColumn] = context.data.getColumns([
    columnTitles.imageCid,
    columnTitles.metaCid,
  ]);
  for (let i = 0; i < dataRecords.length; i++) {
    if (i >= imageCidColumn.records.length) {
      imageCidColumn.records.push('');
    }
    if (i >= metaCidColumn.records.length) {
      metaCidColumn.records.push('');
    }

    if (i >= startRecordNo && i < endRecordNo && !metaCidColumn.records[i]) {
      let imageFile = path.join(imageFolder, `${i + 2}.${extension}`);
      const { metaCid, imageCid } = await generateMetadata(
        name,
        description,
        imageFile
      );
      imageCidColumn.records[i] = imageCid;
      metaCidColumn.records[i] = metaCid;
      isUpdated = true;
    }
  }
  if (isUpdated) {
    context.data.setColumns([imageCidColumn, metaCidColumn]);
    context.data.checkpoint();
  }
};

const setInstanceMetadata = async () => {
  //5- set metadata for instances
  const context = getContext();
  const { startRecordNo, endRecordNo } = context.data;
  // read classId from checkpoint
  if (context.class.id == null) {
    throw new Error(
      'No classId checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  const [metaCidColumn, instanceIdColumn] = context.data.getColumns([
    columnTitles.metaCid,
    columnTitles.instanceId,
  ]);

  if (
    !metaCidColumn.records ||
    !metaCidColumn.records[startRecordNo] ||
    !metaCidColumn.records[endRecordNo]
  ) {
    throw new Error(
      'No metadata checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  if (
    !instanceIdColumn.records ||
    !instanceIdColumn.records[startRecordNo] ||
    !instanceIdColumn.records[endRecordNo]
  ) {
    throw new Error(
      'No instanceId checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  // set the metadata for instances in batch
  let batchSize = parseInt(wfSetting?.instance?.batchSize) || 100;
  let lastBatch = context.batch.lastMetadataBatch || 0;
  let instanceMetadatas = [];
  for (let i = 0; i <= context.data.records.length; i++) {
    metadata = {
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
      classId,
      instanceMetadatas.slice(batchStartRecordNo, batchEndRecordNo)
    );
    lastBatch += 1;
    console.log(events);
    console.log(`Batch number ${lastBatch} was minted successfully`);
    context.batch.lastMetadataBatch = lastBatch;
    context.batch.checkpoint();
  }
};

const runWorkflow = async () => {
  // load the csv file with the required columns (first name, last name, email ), fail if columns are missing
  // for each row from <starting row> up to the <maxmimum count> create
  let { api, signingPair } = await connect();

  // 1- create class
  await createClass();

  // 2- set classMetadata
  await setClassMetadata();

  // 3- generate secrets
  await generateGiftSecrets();

  //4- mint instances in batch
  await mintInstancesInBatch();
  /*
  context.class.load();
  console.log(context.class.id, context.class.metaCid);
  context.class.id = 1005;
  context.class.metaCid = 'Qme1SdjcoZo11GzxT5ahHFN3sCK5thoB1pbDx1oTxjH6ak';
  context.class.checkpoint();

  context.batch.load();
  console.log(context.batch.lastMintBatch, context.batch.lastMetadataBatch);
  context.batch.lastMintBatch = 10;
  context.batch.lastMetadataBatch = '1';
  context.batch.checkpoint();

  context.data.load();
  let column = context.data.getColumns(['my new column']);
  console.log(column?.records?.length, column?.records[0]);
  column = { title: 'my new column', records: [] };
  for (let i = 0; i < context.data.records.length; i++) {
    column.records.push(i);
  }
  context.data.setColumns([column]);
  console.log(column?.records?.length, column?.records[0]);
  context.data.checkpoint();*/
};

module.exports = {
  runWorkflow,
};
