const fs = require('fs');
const inquirer = require('inquirer');
const path = require('path');
const { connect } = require('../chain/chain');
const { createPinataClient } = require('../pinata/pinataClient');
const {
  writeCsvSync,
  readCsvSync,
  getColumnIndex,
  getColumns,
} = require('../utils/csv');
const { systemMessage } = require('../utils/styles');
const { WorkflowError } = require('../Errors');

const inqAsk = inquirer.createPromptModule();

const checkpointBasePath = './';
const checkpointFolderName = '.checkpoint';
const checkpointFolderPath = path.resolve(
  `${checkpointBasePath}`,
  checkpointFolderName
);
const columnTitles = {
  classId: 'classId',
  instanceId: 'instanceId',
  classMetadata: 'classMetadata',
  instanceMetadata: 'instanceMetadat',
  secret: 'gift account secret',
  address: 'gift account address',
  imageCid: 'image cid',
  videoCid: 'video cid',
  metaCid: 'metadata cid',
  lastMintBatch: 'last minted batch',
  lastMetadataBatch: 'last metadata batch',
  lastBalanceTxBatch: 'last balance transfer batch',
};

const cpfiles = {
  class: path.resolve(checkpointFolderPath, `.class.cp`),
  data: path.resolve(checkpointFolderPath, `.data.cp`),
  batch: path.resolve(checkpointFolderPath, `.batch.cp`),
};

const getCheckpointRecords = (file) => {
  if (fs.existsSync(file)) {
    return readCsvSync(file);
  } else {
    return {};
  }
};

const removeCheckpoints = () => {
  try {
    if (fs.existsSync(cpfiles.batch)) fs.unlinkSync(cpfiles.batch);
    if (fs.existsSync(cpfiles.data)) fs.unlinkSync(cpfiles.data);
    if (fs.existsSync(cpfiles.class)) fs.unlinkSync(cpfiles.class);
    if (fs.existsSync(checkpointFolderPath)) fs.rmdirSync(checkpointFolderPath);
  } catch (err) {
    console.error(err);
  }
};

const context = {
  isLoaded: false,
  load: async function (wfConfig) {
    this.network = await connect(wfConfig?.network);
    this.pinataClient = createPinataClient(wfConfig?.pinata);

    // Create checkpoint path if it does not exist
    if (!fs.existsSync(checkpointFolderPath)) {
      try {
        fs.mkdirSync(checkpointFolderPath);
      } catch {
        throw new WorkflowError(`Unable to create ${checkpointFolderPath} folder. Please check if the parent dir has a write access`);
      }
    }

    this.class.load(wfConfig);
    this.batch.load(wfConfig);
    this.data.load(wfConfig);

    this.isLoaded = true;
  },
  clean: function () {
    removeCheckpoints();
  },
  network: undefined,
  dryRun: false,
  pinataClient: undefined,
  class: {
    id: undefined,
    metaCid: undefined,
    load: function (wfConfig) {
      let { header, records } = getCheckpointRecords(cpfiles.class) || {};
      if (header) {
        let [classIdIdx, classMetaIdx] = getColumnIndex(header, [
          columnTitles.classId,
          columnTitles.classMetadata,
        ]);
        if (records[0]?.[classIdIdx]) {
          this.id = records[0][classIdIdx];
        }
        if (records[0]?.[classMetaIdx]) {
          this.metaCid = records[0][classMetaIdx];
        }
      }
    },
    checkpoint: function () {
      writeCsvSync(
        cpfiles.class,
        [columnTitles.classId, columnTitles.classMetadata],
        [[this.id, this.metaCid]]
      );
    },
  },
  data: {
    header: [],
    records: [],
    startRecordNo: undefined,
    endRecordNo: undefined,
    getColumns: function (columnTitles) {
      if (this.header) {
        return getColumns(columnTitles, this.header, this.records);
      } else {
        return [];
      }
    },
    setColumns: function (columns) {
      let columnIdxs = [];
      columns.forEach((column) => {
        if (column.records.length !== this.records.length) {
          throw new WorkflowError(
            `Can not add the column ${column.title} to records. The number of records in the column is not equal to the number of data records`
          );
        }
        let [idx] = getColumnIndex(this.header, [column.title]);
        if (idx == null) {
          this.header.push(column.title);
          idx = this.header.length - 1;
        }
        columnIdxs.push(idx);
      });
      for (let r = 0; r < this.records.length; r++) {
        for (let c = 0; c < columns.length; c++) {
          this.records[r][columnIdxs[c]] = columns[c].records[r];
        }
      }
    },
    load: function (wfConfig) {
      let datafile = wfConfig?.instance?.data?.csvFile;
      if (!datafile) {
        throw new WorkflowError(
          'The data source is not configured. Please configure instance.data.csvFile in your workflow.json'
        );
      }
      if (!fs.existsSync(datafile)) {
        throw new WorkflowError(
          `The configured datafile does not exists. Please check if path: ${datafile} exists`
        );
      }
      // copy file to checkpoint path if checkpoint does not already exist
      if (!fs.existsSync(cpfiles.data)) {
        fs.copyFileSync(datafile, cpfiles.data);
      }

      let { header, records } = getCheckpointRecords(cpfiles.data) || {};
      this.header = header;
      this.records = records;

      // set start and end row numbers
      const instanceOffset = parseInt(wfConfig?.instance?.data?.offset)
        ? parseInt(wfConfig?.instance?.data?.offset) - 1
        : 0;
      const instanceCount =
        parseInt(wfConfig?.instance?.data?.count) ||
        records.length - instanceOffset + 1;
      this.startRecordNo = instanceOffset;
      this.endRecordNo = Math.min(
        this.startRecordNo + instanceCount,
        records.length
      );
    },
    checkpoint: function () {
      writeCsvSync(cpfiles.data, this.header, this.records);
    },
    writeFinalResult: function (outFilename) {
      // copy the final datafile to the outputFile
      fs.copyFileSync(cpfiles.data, outFilename);
    },
  },
  batch: {
    lastMintBatch: 0,
    lastMetadataBatch: 0,
    lastBalanceTxBatch: 0,
    load: function (wfConfig) {
      let { header, records } = getCheckpointRecords(cpfiles.batch) || {};
      if (header) {
        let [lastMintBatchIdx, lastMetaBatchIdx, lastBalanceTxBatchIdx] =
          getColumnIndex(header, [
            columnTitles.lastMintBatch,
            columnTitles.lastMetadataBatch,
            columnTitles.lastBalanceTxBatch,
          ]);
        if (records[0]?.[lastMintBatchIdx]) {
          this.lastMintBatch = parseInt(records[0][lastMintBatchIdx]);
        }
        if (records[0]?.[lastMetaBatchIdx]) {
          this.lastMetadataBatch = parseInt(records[0][lastMetaBatchIdx]);
        }
        if (records[0]?.[lastBalanceTxBatchIdx]) {
          this.lastBalanceTxBatch = parseInt(records[0][lastBalanceTxBatchIdx]);
        }
      }
    },
    checkpoint: function () {
      writeCsvSync(
        cpfiles.batch,
        [
          columnTitles.lastMintBatch,
          columnTitles.lastMetadataBatch,
          columnTitles.lastBalanceTxBatch,
        ],
        [[this.lastMintBatch, this.lastMetadataBatch, this.lastBalanceTxBatch]]
      );
    },
  },
};

const loadContext = async (wfConfig) => {
  await context.load(wfConfig);
  return context;
};

const getContext = () => {
  if (!context.isLoaded) {
    throw new WorkflowError('The context for the workflow is not loaded.');
  }
  return context;
};

const checkPreviousCheckpoints = async () => {
  const checkpointExists = fs.existsSync(cpfiles.class) || fs.existsSync(cpfiles.batch) || fs.existsSync(cpfiles.data);
  if (!checkpointExists) return;

  const answer = (await inqAsk([
    {
      type: 'confirm',
      name: 'continueFromCheckpoint',
      message: `Previous checkpoints detected, do you want to continue from the last recorded checkpoint?`,
      default: true,
    },
  ])) || { continueFromCheckpoint: true };

  if (answer?.continueFromCheckpoint) return;

  removeCheckpoints();
  console.log(systemMessage('Previous checkpoints removed'));
}

module.exports = { columnTitles, checkPreviousCheckpoints, loadContext, getContext };
