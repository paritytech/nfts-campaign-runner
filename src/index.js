const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { writeCsvSync, readCsvSync, getColumnIndex } = require('./csv');
const { generateAndSetClassMetadata } = require('./metadata');
const { generateSecret } = require('./giftSecrets');
const { mintClassInstances } = require('./mint');

const { connect } = require('./chain/chain');
const wfSetting = require('./workflow.json');
const { signAndSendTx } = require('./chain/txHandler');

const checkpointPath = './';
const inqAsk = inquirer.createPromptModule();

const headerTitles = {
  classId: 'classId',
  classMetadata: 'classMetadata',
  secret: 'gift account secret',
  address: 'gift account address',
  lastBatch: 'last minted batch number',
};

const runWorkflow = async () => {
  // load the csv file with the required columns (first name, last name, email ), fail if columns are missing
  // for each row from <starting row> up to the <maxmimum count> create
  let { api, signingPair } = await connect();

  // 1- create class
  let classCheckpoint = path.join(__dirname, `${checkpointPath}/.class.cp`);
  let classId;
  let appendToClass;
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

  // if a valid class is not already created does not exist, create the class
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
        appendToClass = answer?.appendToClass;
      }
    } else {
      // create a new class
      classId = cfgClassId;
      let tx = api.tx.uniques.create(classId, signingPair?.address);
      await signAndSendTx(api, tx, signingPair);
      // write the class checkpoint
    }
    writeCsvSync(classCheckpoint, [headerTitles.classId], [[classId]]);
  }

  // 2-generate/set class metadata
  let classMeta;
  if (fs.existsSync(classCheckpoint)) {
    // a class checkpoint already exists check if the metadata is already created
    let { header: classHeader, records: classRecords } =
      readCsvSync(classCheckpoint);
    let [classMetaIndex] = getColumnIndex(classHeader, [
      headerTitles.classMetadata,
    ]);
    if (!classMetaIndex || !classRecords[0]?.[classMetaIndex]) {
      // class metadata does not exist in the checkpoint
      let classMetadata = await generateAndSetClassMetadata();
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
  let dataCheckpoint = path.join(__dirname, `${checkpointPath}/.data.cp`);
  if (!fs.existsSync(dataCheckpoint)) {
    fs.copyFileSync(datafile, dataCheckpoint);
  }
  const { header: dataHeader, records: dataRecords } =
    readCsvSync(dataCheckpoint);

  // ToDO: if there are no dataRecords throw an error.
  let shouldGenerateSecrets = true;
  const instanceOffset = wfSetting?.instance?.data?.offset
    ? wfSetting?.instance?.data?.offset - 1
    : 0;
  const instanceCount =
    parseInt(wfSetting?.instance?.data?.count) ||
    dataRecords.length - instanceOffset + 1;
  const startRecordNo = instanceOffset;
  const endRecordNo = Math.min(
    startRecordNo + instanceCount,
    dataRecords.length
  );
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

  //4- mint instances in batch
  let batchSize = parseInt(wfSetting?.instance?.batchSize) || 100;
  let { instances: startInstanceId } = await api.query.uniques.class(classId);
  let lastBatch = 0;
  let mintCheckpoint = path.join(__dirname, `${checkpointPath}/.mint.cp`);
  if (fs.existsSync(mintCheckpoint)) {
    // the class has already been created
    const { header: mintHeader, records: mintRecords } =
      readCsvSync(mintCheckpoint);
    const [lastBatchIndex] = getColumnIndex(mintHeader, [
      headerTitles.lastBatch,
    ]);
    if (
      /* loose equality (==) is used to coerce values */
      lastBatchIndex != null
    ) {
      lastBatch = mintRecords[0]?.[lastBatchIndex] || 0;
    }
  }
  let ownerAddresses = dataRecords.map((record) => record[addressIndex]);
  while (startRecordNo + lastBatch * batchSize < endRecordNo) {
    console.log(`Sending batch number ${lastBatch + 1}`);
    let batchStartRecordNo = startRecordNo + lastBatch * batchSize;
    let batchEndReordNo = Math.min(
      startRecordNo + (lastBatch + 1) * batchSize,
      endRecordNo
    );
    let events = await mintClassInstances(
      classId,
      startInstanceId,
      ownerAddresses.slice(batchStartRecordNo, batchEndReordNo)
    );
    lastBatch += 1;
    startInstanceId += batchSize;
    console.log(events);
    console.log(`Batch number ${lastBatch} was minted successfully`);
    writeCsvSync(mintCheckpoint, [headerTitles.lastBatch], [[lastBatch]]);
  }
};

runWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
