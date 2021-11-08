const inquirer = require('inquirer');
const fs = require('fs');
const path = require('path');
const { writeCsvSync, readCsvSync, getColumnIndex } = require('./csv');

const { connect } = require('./chain/chain');
const wfSetting = require('./workflow.json');
const { signAndSendTx } = require('./chain/txHandler');
const {
  setClassMetadata,
  generateClassMetaData,
} = require('./scripts/metadata');

const checkpointPath = './.progress';
const inqAsk = inquirer.createPromptModule();

const runWorkflow = async () => {
  // load the csv file with the required columns (first name, last name, email ), fail if columns are missing
  // for each row from <starting row> up to the <maxmimum count> create
  let { api, signingPair } = connect();

  // 1- create class
  let classCheckPoint = path.join(__dirname, `${checkpointPath}/.class.cp.csv`);
  let classId;
  if (!wfSetting.class?.id) {
    throw new Error('No class id was found in workflow setting!');
  }
  if (fs.existsSync(classCheckP)) {
    // the class has already been created
    const { classHeader, classRecords } = readCsvSync(classCheckP);
    const { classIdIndex } = getColumnIndex(classHeader, ['classId']);
    if (wfSetting.class?.id == classRecords[0][classIdIndex])
      classId = classRecords[0][classIdIndex];
  }
  if (!classId) {
    // check the specified class does not exist
    let cfgClassId = wfSetting.class?.id;
    let uniquesClass = await api.query.uniques
      .class(cfgClassId)
      ?.unwrapOr(null);
    if (uniquesClass) {
      // class already exists ask user if they want to mint in the same class
      let { appendToClass } = (await inqAsk([
        {
          type: 'confirm',
          name: 'appendToClass',
          message: `A class with classId:${cfgClassId} already exists, Please confidure`,
          default: false,
        },
      ])) || { appendToClass: false };
      if (!appendToClass) {
        throw new Error(
          'Please set a different class name in your workflow.json seetings.'
        );
      } else {
        classId = cfgClassId;
      }
    } else {
      // create a new class
      let tx = api.tx.uniques.create(classId, signingPair?.address);
      await signAndSendTx(api, tx, signingPair);
      // write the class checkpoint
      writeCsvSync({ classId }, classCheckPoint);
    }

    // 2-generate/set class metadata
    await generateAndSetClassMetadata();

    // 3-create nft secrets + addresses
  }
};
