#!/usr/bin/env node

const { Command } = require('commander');
const {
  runWorkflow,
  updateMetadata,
  renameFolderContent,
  burnAndReap,
} = require('./workflow/workflow');
const { errorMessage, finalMessage } = require('./utils/styles');
const { WorkflowError } = require('./Errors');
const program = new Command();

program.version('0.0.1');

program
  .command('run')
  .description('Run the workflow that is defined in the workflow config file.')
  .argument(`<workflow-config>`, 'the workflow configuration file')
  .option('--dry-run', 'Enable dry-run')
  .action(async (workflowConfig, options) => {
    await runWorkflow(workflowConfig, options.dryRun ?? false);
    console.log(finalMessage('\ndone!'));
  });

program
  .command('update-metadata')
  .description(
    'Set/Update metadata based on the specified information in the workflow. This command assumes the collection and items does exist on chain, otherwise throws an error.'
  )
  .argument(`<workflow-config>`, 'the workflow configuration file')
  .option('--dry-run', 'Enable dry-run')
  .action(async (workflowConfig, options) => {
    await updateMetadata(workflowConfig, options.dryRun ?? false);
    console.log(finalMessage('\ndone!'));
  });

program
  .command('rename-files')
  .description(
    'Rename the files in the src path to an inceremental index starting from the start-index. Saves the renamed files in the destination output path.'
  )
  .option(
    '--start-index <start-index>',
    'The index that the renamed filenames start from.',
    1
  )
  .requiredOption(
    '--ext <extension>',
    'The file extension of the files that are to be renamed.'
  )
  .argument(
    `<input>`,
    'The input directory that its content is going to be renamed'
  )
  .action(async (srcDir, options) => {
    let startIndex = Number(options.startIndex);
    if (isNaN(startIndex)) {
      throw new Error('start-index is not a number!');
    }
    renameFolderContent(srcDir, options.ext, Number(options.startIndex));
    console.log(finalMessage('\ndone!'));
  });

program
  .command('burn-reap')
  .description(
    'Burn the nft items owned by each account/secret and transfer any balance from the account to the original/admin account.'
  )
  .argument(`<workflow-config>`, 'the workflow configuration file')
  .option('--dry-run', 'Enable dry-run')
  .action(async (workflowConfig, options) => {
    await burnAndReap(workflowConfig, options.dryRun ?? false);
    console.log(finalMessage('\ndone!'));
  });

program
  .parseAsync(process.argv)
  .then(() => process.exit(0))
  .catch((err) => {
    if (err instanceof WorkflowError) {
      console.error(errorMessage(err?.message));
    } else {
      console.error(err);
    }
    process.exit(1);
  });

/*
  const tryToSucceed = () => {
  updateMetadata(
    '/Users/hra/Workspace/Parity/Git/uniques-campaign-runner/Decoded/setmeta/workflow.json',
    false
  )
    .then(() => process.exit(0))
    .catch((err) => {
      console.log('err');
      console.error(err);
      setTimeout(tryToSucceed, 60000);
    });
};

tryToSucceed();
*/
