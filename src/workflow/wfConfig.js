const fs = require('fs');
const path = require('path');

let config;
const parseConfig = (cfile) => {
  let errors = {
    section: (section, configFile) => {
      return `No ${section} configuration was found for the workflow in configuration file: ${configFile}.`;
    },
    element: (element, configFile) => {
      return `${element} is not configured in configuration file: ${configFile}.`;
    },
    pathNotExists: (name, path) => {
      return `${name} does not exist at the configured path: ${path}.`;
    },
  };
  // resolve the path a relative path
  let configFile = path.resolve(cfile);
  let configJson;
  if (!fs.existsSync(configFile)) {
    return { error: errors.pathNotExists('workflow config', configFile) };
  } else {
    let jsonStr = fs.readFileSync(configFile);
    configJson = JSON.parse(jsonStr);

    if (!configJson) {
      return {
        error: `No workflow configuration was found in configuration file: ${configFile}`,
      };
    }

    if (!configJson.network) {
      return { error: errors.section('network', configFile) };
    } else {
      if (!configJson.network.provider) {
        return { error: errors.element('network.provider', configFile) };
      }
      if (!configJson.network.accountSeed) {
        return { error: errors.element('network.accountSeed', configFile) };
      }
    }

    if (!configJson.pinata) {
      return { error: errors.section('pinata', configFile) };
    } else {
      if (!configJson.pinata.apiKey) {
        return { error: errors.element('pinana.apiKey', configFile) };
      }
      if (!configJson.pinata.secretApiKey) {
        return { error: errors.element('pinana.secretApiKey', configFile) };
      }
    }

    if (!configJson.class) {
      return { error: errors.section('class', configFile) };
    } else {
      if (!configJson.class.id) {
        return { error: errors.element('class.id', configFile) };
      }
    }

    if (!configJson.instance) {
      return { error: errors.section('instance', configFile) };
    } else {
      if (!configJson.instance.data) {
        return { error: errors.section('instance.data', configFile) };
      } else {
        if (!configJson.instance.data.csvFile) {
          return { error: errors.element('instance.data.csvFile', configFile) };
        } else {
          configJson.instance.data.csvFile = path.resolve(
            configJson.instance.data.csvFile
          );

          // set output path
          let outDir = path.dirname(configJson.instance.data.csvFile);
          let ext = path.extname(configJson.instance.data.csvFile);
          let filename = path.basename(configJson.instance.data.csvFile, ext);
          filename += ext ? `.final${ext}` : `.final`;
          let outFilename = path.join(outDir, filename);
          configJson.instance.data.outputCsvFile = path.resolve(outFilename);

          if (!fs.existsSync(configJson.instance.data.csvFile)) {
            return {
              error: errors.pathNotExists(
                'instance.data.csvFile',
                configJson.instance.data.csvFile
              ),
            };
          }
        }
      }

      if (!configJson.instance.metadata) {
        return { error: errors.section('instance.metadata', configFile) };
      } else {
        if (!configJson.instance.metadata.imageFolder) {
          return {
            error: errors.element('instance.metadata.imageFolder', configFile),
          };
        } else {
          configJson.instance.metadata.imageFolder = path.resolve(
            configJson.instance.metadata.imageFolder
          );
          if (!fs.existsSync(configJson.instance.metadata.imageFolder)) {
            return {
              error: errors.pathNotExists(
                'instance.metadata.imageFolder',
                configJson.instance.metadata.imageFolder
              ),
            };
          }
        }
        if (!configJson.instance.metadata.extension) {
          return {
            error: errors.element('instance.metadata.extension', configFile),
          };
        }
        if (!configJson.instance.metadata.name) {
          return {
            error: errors.element('instance.metadata.name', configFile),
          };
        }
        if (!configJson.instance.metadata.description) {
          return {
            error: errors.element('instance.metadata.description', configFile),
          };
        }
      }
    }
  }

  return { config: configJson };
};

module.exports = { parseConfig };
