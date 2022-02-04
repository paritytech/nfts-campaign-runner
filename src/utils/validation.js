const { WorkflowError } = require('../Errors');
const get = require('lodash.get');
const fs = require('fs');

const errors = {
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

const throwError = (errorText) => { throw new WorkflowError(errorText); };

const validate = (object, keyPath, errorText) => {
  if (!errorText) {
    errorText = keyPath;
    keyPath = '';
  }

  if (!keyPath && !object) {
    throwError(errorText);
  }

  if (keyPath && !get(object, keyPath)) throwError(errorText);
}

const validateSection = (configJson, section, configFile) => {
  validate(configJson, section, errors.section(section, configFile));
};

const validateElement = (configJson, element, configFile) => {
  validate(configJson, element, errors.element(element, configFile));
};

const validateFileExists = (filePath, errorText) => {
  if (!fs.existsSync(filePath)) {
    throwError(errors.pathNotExists(errorText, filePath));
  }
};

module.exports = { throwError, validate, validateFileExists, validateElement, validateSection };
