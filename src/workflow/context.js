const fs = require('fs');
const inquirer = require('inquirer');
const path = require('path');
const { connect } = require('../chain/chain');
const { createPinataClient } = require('../pinata/pinataClient');
const { isNumber } = require('../utils');
const {
  writeCsvSync,
  readCsvSync,
  getColumnIndex,
  getColumns,
} = require('../utils/csv');
const { notificationMessage } = require('../utils/styles');
const { WorkflowError } = require('../Errors');

const inqAsk = inquirer.createPromptModule();

const checkpointBasePath = './';
const checkpointFolderName = '.checkpoint';
const checkpointFolderPath = path.resolve(
  `${checkpointBasePath}`,
  checkpointFolderName
);
const columnTitles = {
  collectionId: 'collectionId',
  itemId: 'itemId',
  collectionMetadata: 'collectionMetadata',
  collectionStartItemId: 'collectionStartItemId',
  isExistingCollection: 'isExistingCollection',
  itemMetadata: 'itemMetadata',
  secret: 'gift account secret',
  address: 'gift account address',
  imageCid: 'image cid',
  videoCid: 'video cid',
  metaCid: 'metadata cid',
  lastMintBatch: 'last minted batch',
  lastMetadataBatch: 'last metadata batch',
  lastMetaCidBatch: 'last metaCid batch',
  lastBalanceTxBatch: 'last balance transfer batch',
  receiver: 'receiver',
};

const cpfiles = {
  collection: path.resolve(checkpointFolderPath, `.collection.cp`),
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
    if (fs.existsSync(cpfiles.collection)) fs.unlinkSync(cpfiles.collection);
    if (fs.existsSync(checkpointFolderPath)) fs.rmdirSync(checkpointFolderPath);
  } catch (err) {
    console.error(err);
  }
};

const context = {
  isLoaded: false,
  load: async function (wfConfig) {
    let network = await connect(wfConfig?.network);
    let chainInfo = {
      decimals: network.api.registry?.chainDecimals[0],
      token: network.api.registry.chainTokens[0],
      ssf8: network.api.registry.chainSS58,
    };
    this.network = { ...network, chainInfo };
    this.pinataClient = createPinataClient(wfConfig?.pinata);

    // Create checkpoint path if it does not exist
    if (!fs.existsSync(checkpointFolderPath)) {
      try {
        fs.mkdirSync(checkpointFolderPath);
      } catch {
        throw new WorkflowError(
          `Unable to create ${checkpointFolderPath} folder. Please check if the parent dir has a write access`
        );
      }
    }

    await this.collection.load(wfConfig, this.network);
    await this.batch.load(wfConfig, this.network);
    await this.data.load(wfConfig, this.network);

    this.isLoaded = true;
  },
  clean: function () {
    removeCheckpoints();
  },
  network: undefined,
  dryRun: false,
  pinataClient: undefined,
  collection: {
    id: undefined,
    startItemId: undefined,
    isExistingCollection: false,
    metaCid: undefined,
    load: async function (wfConfig, network) {
      if (isNumber(wfConfig.collection?.startItemId)) {
        this.startItemId = Number(wfConfig.collection.startItemId);
      }

      let { header, records } = getCheckpointRecords(cpfiles.collection) || {};
      if (header) {
        let [collectionIdIdx, collectionMetaIdx, startItemIdx, isExistingCollectionIdx] =
          getColumnIndex(header, [
            columnTitles.collectionId,
            columnTitles.collectionMetadata,
            columnTitles.collectionStartItemId,
            columnTitles.isExistingCollection,
          ]);
        if (records[0]?.[collectionIdIdx]) {
          this.id = records[0][collectionIdIdx];
        }
        if (records[0]?.[collectionMetaIdx]) {
          this.metaCid = records[0][collectionMetaIdx];
        }
        if (records[0]?.[startItemIdx]) {
          this.startItemId = records[0][startItemIdx];
        }
        if (records[0]?.[isExistingCollectionIdx]) {
          this.isExistingCollection = records[0][isExistingCollectionIdx];
        }
      }
      // check if collection exists and whether a user wants to mint into the existing collection.
      // if a collection was not already created or does not exist, create the collection
      if (wfConfig.collection?.id !== this.id) {
        // check the specified collection does not exist
        const cfgCollectionId = wfConfig.collection.id ?? this.id;
        const { api } = network;
        const storageCollection = (await api.query.nfts.collection(cfgCollectionId))
          ?.unwrapOr(undefined)
          ?.toJSON();

        if (storageCollection) {
          // collection already exists ask user if they want to mint into the same collection
          const answer = (await inqAsk([
            {
              type: 'confirm',
              name: 'appendToCollection',
              message: `A collection with id:${cfgCollectionId} already exists, do you want to mint the nfts into the same collection?`,
              default: false,
            },
          ])) || { appendToCollection: false };
          if (!answer?.appendToCollection) {
            throw new WorkflowError(
              'Please remove the collection id from your workflow.json settings or remove the `.checkpoint/.class.cp` file'
            );
          } else {
            this.id = cfgCollectionId;
            this.startItemId = Number(storageCollection?.items);
            if (isNumber(wfConfig.collection?.startItemId)) {
              this.startItemId += Number(wfConfig.collection.startItemId);
            }
            this.isExistingCollection = true;
            // set the start item id to the last id available in the collection assuming all items are minted from 0 to number of current items.
            console.log(
              notificationMessage(
                `The collection ${cfgCollectionId} exists. The new items will be added to the collection staring from index ${context.collection.startItemId}.`
              )
            );
          }
        } else {
          // create a new collection
          context.collection.id = cfgCollectionId;
        }
      }
    },
    checkpoint: function (id) {
      if (id !== undefined) this.id = id;

      writeCsvSync(
        cpfiles.collection,
        [
          columnTitles.collectionId,
          columnTitles.collectionMetadata,
          columnTitles.collectionStartItemId,
          columnTitles.isExistingCollection,
        ],
        [[this.id, this.metaCid, this.startItemId, this.isExistingCollection]]
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
    addColumn: function (title) {
      this.header.push(title);
      for (let r = 0; r < this.records.length; r++) {
        this.records[r].push('');
      }
    },
    load: async function (wfConfig) {
      let datafile = wfConfig?.item?.data?.csvFile;
      if (!datafile) {
        throw new WorkflowError(
          'The data source is not configured. Please configure item.data.csvFile in your workflow.json'
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
      const itemOffset = parseInt(wfConfig?.item?.data?.offset)
        ? parseInt(wfConfig?.item?.data?.offset) - 1
        : 0;
      const itemCount =
        parseInt(wfConfig?.item?.data?.count) ||
        records.length - itemOffset + 1;
      this.startRecordNo = itemOffset;
      this.endRecordNo = Math.min(
        this.startRecordNo + itemCount,
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
    lastMetaCidBatch: 0,
    lastMetadataBatch: 0,
    lastBalanceTxBatch: 0,
    load: async function (wfConfig) {
      let { header, records } = getCheckpointRecords(cpfiles.batch) || {};
      if (header) {
        let [
          lastMintBatchIdx,
          lastMetaBatchIdx,
          lastMetaCidBatchIdx,
          lastBalanceTxBatchIdx,
        ] = getColumnIndex(header, [
          columnTitles.lastMintBatch,
          columnTitles.lastMetadataBatch,
          columnTitles.lastMetaCidBatch,
          columnTitles.lastBalanceTxBatch,
        ]);
        if (records[0]?.[lastMintBatchIdx]) {
          this.lastMintBatch = parseInt(records[0][lastMintBatchIdx]);
        }
        if (records[0]?.[lastMetaCidBatchIdx]) {
          this.lastMetaCidBatch = parseInt(records[0][lastMetaCidBatchIdx]);
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
          columnTitles.lastMetaCidBatch,
          columnTitles.lastBalanceTxBatch,
        ],
        [
          [
            this.lastMintBatch,
            this.lastMetadataBatch,
            this.lastMetaCidBatch,
            this.lastBalanceTxBatch,
          ],
        ]
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
  const checkpointExists =
    fs.existsSync(cpfiles.collection) ||
    fs.existsSync(cpfiles.batch) ||
    fs.existsSync(cpfiles.data);
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
  console.log(notificationMessage('Previous checkpoints removed'));
};

module.exports = {
  columnTitles,
  checkPreviousCheckpoints,
  loadContext,
  getContext,
};
