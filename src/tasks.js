const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { writeCsvSync, readCsvSync, getColumnIndex } = require('./csv');
const { generateAndSetClassMetadata, generateMetadata } = require('./metadata');
const { generateSecret } = require('./giftSecrets');
const { mintClassInstances } = require('./mint');
const { headerTitles, checkpointFiles } = require('./checkpoint');

const { connect } = require('./chain/chain');
const wfSetting = require('./workflow.json');
const { signAndSendTx } = require('./chain/txHandler');

const inqAsk = inquirer.createPromptModule();

const startRecordNo = 0;
const endRecordNo = -1;

// 1- create class
const createClass = async () => {
  let classCheckpoint = checkpointFiles.class;
  let classId;
  if (!wfSetting.class?.id) {
    throw new Error('No class id was found in workflow setting!');
  }
  if (fs.existsSync(classCheckpoint)) {
    // the class has already been created
    const { header: classHeader, records: classRecords } =
      readCsvSync(classCheckpoint);
    const [classIdIndex] = getColumnIndex(classHeader, [headerTitles.classId]);
    if (
      /* loose equality (==) is used to coerce types */
      classIdIndex != null &&
      wfSetting.class?.id == classRecords[0][classIdIndex]
    ) {
      // classId exists and is valid
      classId = classRecords[0][classIdIndex];
    }
  }

  // if a valid class is not already created or does not exist, create the class
  if (!classId) {
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
        classId = cfgClassId;
      }
    } else {
      // create a new class
      classId = cfgClassId;
      let tx = api.tx.uniques.create(classId, signingPair?.address);
      await signAndSendTx(api, tx, signingPair);
    }
    // write the class checkpoint
    writeCsvSync(classCheckpoint, [headerTitles.classId], [[classId]]);
  }
};

// 2-generate/set class metadata
const setClassMetadata = async () => {
  let classCheckpoint = checkpointFiles.class;
  if (fs.existsSync(classCheckpoint)) {
    // a class checkpoint already exists check if the metadata is already created
    let { header: classHeader, records: classRecords } =
      readCsvSync(classCheckpoint);
    let [classIdIndex, classMetaIndex] = getColumnIndex(classHeader, [
      headerTitles.classId,
      headerTitles.classMetadata,
    ]);
    if (!classId) {
      throw new Error(
        'No classId is recorded in checkpoint, Class is not created or the class checkpoint is not recorded correctly or maybe compromised.'
      );
    }
    if (!classMetaIndex || !classRecords[0]?.[classMetaIndex]) {
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
          throw new Error(
            'Please configure a class metadata in workflow.json.'
          );
        } else {
          let classMetadata = await generateAndSetClassMetadata(
            classId,
            metadata
          );
          if (classMetadata) {
            // new metadata is created add it to the checkpoint
            if (classMetaIndex == null) {
              classHeader.push(headerTitles.classMetadata);
              classMetaIndex = classHeader.length - 1;
            }
            classRecords[0][classMetaIndex] = classMetadata;
            console.log({ classCheckpoint, classHeader, classRecords });
            writeCsvSync(classCheckpoint, classHeader, classRecords);
          }
        }
      }
    }
  } else {
    throw new Error(
      'No class checkpoint was found, The class is not created or the class checkpoint is not recorded correctly.'
    );
  }
};

const generateGiftSecrets = async () => {
  // 3-create nft secrets + addresses
  let datafile = wfSetting?.instance?.data?.csvFile;
  if (!datafile) {
    throw new Error(
      'The data source is not configured. Please configure instance.data.csvFile in your workflow.json'
    );
  }
  if (!fs.existsSync(datafile)) {
    throw new Error(
      `The configured datafile does not exists. Please check if path: ${datafile} exists`
    );
  }
  // copy file to checkpoint path if checkpoiint does not already exist
  let dataCheckpoint = checkpointFiles.data;
  if (!fs.existsSync(dataCheckpoint)) {
    fs.copyFileSync(datafile, dataCheckpoint);
  }
  const { header: dataHeader, records: dataRecords } =
    readCsvSync(dataCheckpoint);

  // ToDO: if there are no dataRecords throw an error.
  const instanceOffset = wfSetting?.instance?.data?.offset
    ? wfSetting?.instance?.data?.offset - 1
    : 0;
  const instanceCount =
    parseInt(wfSetting?.instance?.data?.count) ||
    dataRecords.length - instanceOffset + 1;
  startRecordNo = instanceOffset;
  endRecordNo = Math.min(startRecordNo + instanceCount, dataRecords.length);
  // ToDO: check if instanceOffset + instanceCount is out of cound (> dataRecords.length) throw an error
  let [secretIndex, addressIndex] = getColumnIndex(dataHeader, [
    headerTitles.secret,
    headerTitles.address,
  ]);

  if (secretIndex == null) {
    dataHeader.push(headerTitles.secret);
    secretIndex = dataHeader.length - 1;
  }
  if (addressIndex == null) {
    dataHeader.push(headerTitles.address);
    addressIndex = dataHeader.length - 1;
  }

  let isUpdated = false;
  for (let i = 0; i < dataRecords.length; i++) {
    if (secretIndex >= dataRecords[i].length) {
      dataRecords[i].push('');
    }
    if (addressIndex >= dataRecords[i].length) {
      dataRecords[i].push('');
    }

    if (i >= startRecordNo && i < endRecordNo && !dataRecords[i][secretIndex]) {
      const { secret, address } = await generateSecret();
      dataRecords[i][secretIndex] = secret;
      dataRecords[i][addressIndex] = address;
      isUpdated = true;
    }
  }
  if (isUpdated) {
    writeCsvSync(dataCheckpoint, dataHeader, dataRecords);
  }
};

const mintInstancesInBatch = async () => {
  //4- mint instances in batch
  let batchSize = parseInt(wfSetting?.instance?.batchSize) || 100;
  let { instances: startInstanceId } = await api.query.uniques.class(classId);
  let lastBatch = 0;
  let batchCheckpoint = checkpointFiles.batch;
  if (fs.existsSync(batchCheckpoint)) {
    // the class has already been created
    const { header: batchHeader, records: batchRecords } =
      readCsvSync(batchCheckpoint);
    const [lastBatchIndex] = getColumnIndex(batchHeader, [
      headerTitles.lastMintBatch,
    ]);
    if (
      /* loose equality (==) is used to coerce values */
      lastBatchIndex != null
    ) {
      lastBatch = batchRecords[0]?.[lastMintBatchIndex] || 0;
    } else {
      lastBatch = 0;
      batchHeader.push(headerTitles.lastMintBatch);
      batchRecords.push('');
      lastBatchIndex = batchHeader.length - 1;
    }
  }
  let ownerAddresses = dataRecords.map((record) => record[addressIndex]);
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
    batchRecords[0][lastBatchIndex] = lastBatch;
    writeCsvSync(batchCheckpoint, batchHeader, batchRecords);
  }

  let [instanceIdIndex] = getColumnIndex(dataHeader, [headerTitles.instanceId]);
  if (instanceIdIndex == null) {
    dataHeader.push(headerTitles.instanceId);
    instanceIdIndex = dataHeader.length - 1;
  }

  // all instances are minted. set the instanceId for each record in data checkpoint.
  let currentInstanceId = startInstanceId;
  for (let i = 0; i <= dataRecords.length; i++) {
    if (instanceIdIndex > dataRecords.length) {
      dataRecords.push('');
    }
    if (i >= startRecordNo && i < endRecordNo) {
      dataRecord[instanceIdIndex] = startInstanceId + 1;
    }
  }
};

const pinAndSetImageCid = async () => {
  let dataCheckpoint = checkpointFiles.data;
  if (!fs.existsSync(dataCheckpoint)) {
    throw new Error(
      'No data checkpoint was found, The data checkpoint is not recorded correctly.'
    );
  }

  const { name, description, imageFolder, extension } =
    wfSetting?.instance?.metadata;
  if (!fs.existsSync(imageFolder)) {
    throw new Error(
      `The instance image folder :${imageFolder} does not exist!`
    );
  }

  // a class checkpoint already exists check if the metadata is already created
  let { header: dataHeader, records: dataRecords } =
    readCsvSync(dataCheckpoint);
  let [imageCidIndex, metaCidIndex] = getColumnIndex(dataHeader, [
    headerTitles.imageCid,
    headerTitles.metaCid,
  ]);
  if (imageCidIndex == null) {
    dataHeader.push(headerTitles.imageCid);
    imageCidIndex = dataHeader.length - 1;
  }
  if (metaCidIndex == null) {
    dataHeader.push(headerTitles.metaCid);
    metaCidIndex = dataHeader.length - 1;
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
  for (let i = 0; i < dataRecords.length; i++) {
    if (imageCidIndex >= dataRecords[i].length) {
      dataRecords[i].push('');
    }
    if (metaCidIndex >= dataRecords[i].length) {
      dataRecords[i].push('');
    }

    if (
      i >= startRecordNo &&
      i < endRecordNo &&
      !dataRecords[i][imageCidIndex]
    ) {
      let imageFile = path.join(imageFolder, `${i + 2}.${extension}`);
      const { metaCid, imageCid } = await generateMetadata(
        name,
        description,
        imageFile
      );
      dataRecords[i][imageCidIndex] = imageCid;
      dataRecords[i][metaCidIndex] = metaCid;
      isUpdated = true;
    }
  }
  if (isUpdated) {
    writeCsvSync(dataCheckpoint, dataHeader, dataRecords);
  }
};

const setInstanceMetadata = async () => {
  //5- set metadata for instances

  // read classId from checkpoint
  let classCheckpoint = checkpointFiles.class;
  let classId;
  if (fs.existsSync(classCheckpoint)) {
    let { header: classHeader, records: classRecords } =
      readCsvSync(classCheckpoint);
    let [classIdIndex] = getColumnIndex(classHeader, [headerTitles.classId]);
    if (classIdIndex || classRecords[0]?.[classIdIndex]) {
      classId = classRecords[0][classIdIndex];
    }
  }
  if (classId == null) {
    throw new Error(
      'No classId checkpoint is recorded or the checkpoint is not in correct state'
    );
  }

  let dataCheckpoint = checkpointFiles.data;
  if (!fs.existsSync(dataCheckpoint)) {
    throw new Error(
      'No data checkpoint was found, The data checkpoint is not recorded correctly.'
    );
  }
  let { header: classHeader, records: classRecords } =
    readCsvSync(dataCheckpoint);
  let [metaCidIndex, instanceIdIndex] = getColumnIndex(classHeader, [
    headerTitles.metaCid,
    headerTitles.instanceId,
  ]);

  if (!metaCidIndex) {
    throw new Error(
      'No metadata checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  if (!instanceIdIndex) {
    throw new Error(
      'No instanceId checkpoint is recorded or the checkpoint is not in a correct state.'
    );
  }

  // set the metadata for instances in batch
  let batchSize = parseInt(wfSetting?.instance?.batchSize) || 100;
  let lastBatch = 0;
  let batchCheckpoint = checkpointFiles.batch;
  if (fs.existsSync(batchCheckpoint)) {
    // the class has already been created
    const { header: batchHeader, records: batchRecords } =
      readCsvSync(batchCheckpoint);
    const [lastBatchIndex] = getColumnIndex(batchHeader, [
      headerTitles.lastBatch,
    ]);
    if (
      /* loose equality (==) is used to coerce values */
      lastBatchIndex != null
    ) {
      lastBatch = batchRecords[0]?.[lastBatchIndex] || 0;
    }
  }
  while (startRecordNo + lastBatch * batchSize < endRecordNo) {
    console.log(`Sending batch number ${lastBatch + 1}`);
    let batchStartRecordNo = startRecordNo + lastBatch * batchSize;
    let batchEndRecordNo = Math.min(
      startRecordNo + (lastBatch + 1) * batchSize,
      endRecordNo
    );

    lastBatch += 1;
    console.log(events);
    console.log(`Batch number ${lastBatch} was minted successfully`);
    writeCsvSync(mintCheckpoint, [headerTitles.lastBatch], [[lastBatch]]);
  }
};
