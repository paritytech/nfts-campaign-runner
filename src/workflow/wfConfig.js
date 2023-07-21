const path = require('path');
const { isEmptyObject } = require('../utils');
const {
  validate,
  validateFileAccess,
  validateFileExists,
  validateElement,
  validateSection,
} = require('../utils/validation');

const parseConfig = (cfile) => {
  // resolve the path a relative path
  let configFile = path.resolve(cfile);
  let configJson;

  try {
    validateFileExists(configFile, 'workflow config');

    configJson = require(configFile);
    validate(
      configJson,
      `No workflow configuration was found in configuration file: ${configFile}`
    );

    // network
    validateSection(configJson, 'network', configFile);
    validateElement(configJson, 'network.provider', configFile);
    validateElement(configJson, 'network.accountSeed', configFile);

    // pinata
    validateSection(configJson, 'pinata', configFile);
    validateElement(configJson, 'pinata.apiKey', configFile);
    validateElement(configJson, 'pinata.secretApiKey', configFile);

    // collection
    validateSection(configJson, 'collection', configFile);
    validateElement(configJson, 'collection.id', configFile);
    if (configJson.collection.metadata?.imageFile) {
      validateFileExists(
        path.resolve(configJson.collection.metadata.imageFile),
        'collection.metadata.imageFile'
      );
    }
    if (configJson.collection.metadata?.videoFile) {
      validateFileExists(
        path.resolve(configJson.collection.metadata.videoFile),
        'collection.metadata.videoFile'
      );
    }

    // item
    validateSection(configJson, 'item', configFile);

    // item.data
    validateSection(configJson, 'item.data', configFile);
    validateElement(configJson, 'item.data.csvFile', configFile);

    configJson.item.data.csvFile = path.resolve(
      configJson.item.data.csvFile
    );

    // set output path
    let outDir = path.dirname(configJson.item.data.csvFile);
    let ext = path.extname(configJson.item.data.csvFile);
    let filename = path.basename(configJson.item.data.csvFile, ext);
    filename += ext ? `.final${ext}` : `.final`;
    let outFilename = path.join(outDir, filename);
    let metaFolderName = 'metadata';
    let metaFolderPath = path.join(outDir, metaFolderName);
    configJson.metadataFolder = path.resolve(metaFolderPath);
    configJson.item.data.outputCsvFile = path.resolve(outFilename);

    validateFileExists(
      configJson.item.data.csvFile,
      'item.data.csvFile'
    );
    validateFileAccess(outDir, 'write');

    // item.metadata
    const itemMetadata = configJson.item.metadata;
    if (!isEmptyObject(itemMetadata)) {
      if (itemMetadata.imageFile) {
        const parts = itemMetadata.imageFile.split('/');
        const imageFileNameTemplate = parts.pop();
        const imageFolder = parts.join('/');

        configJson.item.metadata.imageFolder = path.resolve(imageFolder);
        configJson.item.metadata.imageFileNameTemplate =
          imageFileNameTemplate;

        validateFileExists(
          configJson.item.metadata.imageFolder,
          'item.metadata.imageFile'
        );
      }

      if (itemMetadata.videoFile) {
        const parts = itemMetadata.videoFile.split('/');
        const videoFileNameTemplate = parts.pop();
        const videoFolder = parts.join('/');

        configJson.item.metadata.videoFolder = path.resolve(videoFolder);
        configJson.item.metadata.videoFileNameTemplate =
          videoFileNameTemplate;

        validateFileExists(
          configJson.item.metadata.videoFolder,
          'item.metadata.videoFile'
        );
      }

      validateElement(configJson, 'item.metadata.name', configFile);
      validateElement(configJson, 'item.metadata.description', configFile);
    }
  } catch (error) {
    return { error: error.message ?? error.toString() };
  }

  return { config: configJson };
};

module.exports = { parseConfig };
