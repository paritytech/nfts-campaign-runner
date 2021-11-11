const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { writeCsvSync, readCsvSync, getColumnIndex } = require('./csv');
const { generateAndSetClassMetadata } = require('./scripts/metadata');

const { connect } = require('./chain/chain');
const wfSetting = require('./workflow.json');
const { signAndSendTx } = require('./chain/txHandler');

const checkpointPath = './';
const inqAsk = inquirer.createPromptModule();

const runWorkflow = async () => {
  // load the csv file with the required columns (first name, last name, email ), fail if columns are missing
  // for each row from <starting row> up to the <maxmimum count> create
  let { api, signingPair } = await connect();

  // 1- create class
  let classCheckpoint = path.join(__dirname, `${checkpointPath}/.class.cp`);
  let classId;
  if (!wfSetting.class?.id) {
    throw new Error('No class id was found in workflow setting!');
  }
  if (fs.existsSync(classCheckpoint)) {
    // the class has already been created
    const { header: classHeader, records: classRecords } =
      readCsvSync(classCheckpoint);
    const { classIdIndex } = getColumnIndex(classHeader, ['classId']);
    if (classIdIndex && wfSetting.class?.id == classRecords[0][classIdIndex])
      // classId exists and is valid
      classId = classRecords[0][classIdIndex];
  }

  // if a valid class is not already created does not exist, create the class
  if (!classId) {
    // check the specified class does not exist
    let cfgClassId = wfSetting.class?.id;
    let uniquesClass = await api.query.uniques.class(cfgClassId);
    if (uniquesClass?.isSome) {
      // class already exists ask user if they want to mint in the same class
      let { appendToClass } = (await inqAsk([
        {
          type: 'confirm',
          name: 'appendToClass',
          message: `A class with classId:${cfgClassId} already exists, do you want to create the instances in the same class?`,
          default: false,
        },
      ])) || { appendToClass: false };
      if (!appendToClass) {
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
      // write the class checkpoint
    }
    writeCsvSync(classCheckpoint, ['classId'], [[classId]]);
  }

  // 2-generate/set class metadata
  let classMeta;
  if (fs.existsSync(classCheckpoint)) {
    // a class checkpoint already exists check if the metadata is already created
    let { header: classHeader, records: classRecords } =
      readCsvSync(classCheckpoint);
    let { classMetaIndex } = getColumnIndex(classHeader, ['classMetadata']);
    if (!classMetaIndex || !classRecords[0]?.[classMetaIndex]) {
      // class metadata does not exist in the checkpoint
      let classMetadata = await generateAndSetClassMetadata();
      if (classMetadata) {
        // new metadata is created add it to the checkpoint
        if (!classMetaIndex) {
          classHeader.push('classMetadata');
          classMetaIndex = classHeader.length - 1;
        }
        classRecords[0][classMetaIndex] = classMetadata;
        console.log({ classCheckpoint, classHeader, classRecords });
        writeCsvSync(classCheckpoint, classHeader, classRecords);
      }
    }
  }

  // 3-create nft secrets + addresses
};

runWorkflow()
  .then(() => process.exit(0))
  .catch((err) => {
    console.log(err);
    process.exit(1);
  });
