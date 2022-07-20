const chalk = require('chalk');

const errorMessage = chalk.red;
const finalMessage = chalk.bold;
const importantMessage = chalk.bold.green;
const stepTitle = chalk.underline.bold;
const notificationMessage = chalk.yellow;

module.exports = {
  errorMessage,
  finalMessage,
  importantMessage,
  stepTitle,
  notificationMessage,
};
