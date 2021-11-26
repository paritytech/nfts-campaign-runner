const fs = require('fs');
const path = require('path');
const {
  writeCsvSync,
  readCsvSync,
  getColumnIndex,
  getColumns,
} = require('./csv');
const wfSetting = require('./workflow.json');

const checkpointPath = './';
const columnTitles = {
  classId: 'classId',
  instanceId: 'instanceId',
  classMetadata: 'classMetadata',
  instanceMetadata: 'instanceMetadat',
  secret: 'gift account secret',
  address: 'gift account address',
  imageCid: 'image cid',
  metaCid: 'metadata cid',
  lastMintBatch: 'last minted batch',
  lastMetadataBatch: 'last metadata batch',
};

const cpfiles = {
  class: path.join(__dirname, `${checkpointPath}/.class.cp`),
  data: path.join(__dirname, `${checkpointPath}/.data.cp`),
  batch: path.join(__dirname, `${checkpointPath}/.batch.cp`),
};

const getCheckpointRecords = (file) => {
  if (fs.existsSync(file)) {
    return readCsvSync(file);
  } else {
    return {};
  }
};

const context = {
  isLoaded: false,
  load: function () {
    this.class.load();
    this.batch.load();
    this.data.load();
  },
  class: {
    id: undefined,
    metaCid: undefined,
    load: function () {
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
          throw new Error(
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
    load: function () {
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
      if (!fs.existsSync(cpfiles.data)) {
        fs.copyFileSync(datafile, cpfiles.data);
      }

      let { header, records } = getCheckpointRecords(cpfiles.data) || {};
      this.header = header;
      this.records = records;

      // set satrt and end row numbers
      const instanceOffset = parseInt(wfSetting?.instance?.data?.offset)
        ? parseInt(wfSetting?.instance?.data?.offset) - 1
        : 0;
      const instanceCount =
        parseInt(wfSetting?.instance?.data?.count) ||
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
  },
  batch: {
    lastMintBatch: 0,
    lastMetadataBatch: 0,
    load: function () {
      let { header, records } = getCheckpointRecords(cpfiles.batch) || {};
      if (header) {
        let [lastMintBatchIdx, lastMetaBatchIdx] = getColumnIndex(header, [
          columnTitles.lastMintBatch,
          columnTitles.lastMetadataBatch,
        ]);
        if (records[0]?.[lastMintBatchIdx]) {
          this.lastMintBatch = parseInt(records[0][lastMintBatchIdx]);
        }
        if (records[0]?.[lastMetaBatchIdx]) {
          this.lastMetadataBatch = parseInt(records[0][lastMetaBatchIdx]);
        }
      }
    },
    checkpoint: function () {
      writeCsvSync(
        cpfiles.batch,
        [columnTitles.lastMintBatch, columnTitles.lastMetadataBatch],
        [[this.lastMintBatch, this.lastMetadataBatch]]
      );
    },
  },
};

const getContext = () => {
  if (!context.isLoaded) {
    console.log('loading context ...');
    context.load();
  }
  return context;
};
module.exports = { columnTitles: columnTitles, getContext };
