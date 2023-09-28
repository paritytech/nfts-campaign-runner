# nfts-campaign-runner

This CLI tool allows to mint NFTs in bulk and creates NFT gift secret codes which can be claimed using the [NFTs claim app](https://github.com/paritytech/claim-nft) 
on [Kusama](https://claimnft.kusama.network) or [Polkadot](https://claimnft.polkadot.network).

## Install

To install the tool, clone this repo:

```bash
# Clone the repository
git clone https://github.com/paritytech/nfts-campaign-runner.git
cd nfts-campaign-runner
```

and install the npm package from the project directory.

```bash
npm install -g .
```

## Define a workflow

To define a workflow you need to provide the cli with a workflow `.json` file which can be created based on the following template:

```json
{
  "network": {
    "provider": "<provider e.g. wss://polkadot-asset-hub-rpc.polkadot.io>",
    "accountSeed": "<the minter/admin account seed>",
    "proxiedAddress": "<in case the account is a proxy for another account, the address of the proxied/primary account>"
  },
  "pinata": {
    "apiKey": "<PinataApiKey>",
    "secretApiKey": "<PinataSecretApiKey>"
  },
  "collection": {
    "id": "<leave an empty string to create a new collection or put the collection's id to continue minting into that collection>",
    "startItemId": 0,
    "metadata": {
      "imageFile": "<Path to the image file that is used for collection metadata>",
      "videoFile": "<Path to the video file that is used for collection metadata>",
      "name": "<the value for the name field in collection metadata>",
      "description": "the value for the description field in collection metadata"
    }
  },
  "item": {
    "data": {
      "csvFile": "<a csv file that contains the items data>",
      "offset": "<the row offset, if not specified it starts from row 0>",
      "count": "<the number of rows to be used after offset, if not specified it will count up to the last row.>"
    },
    "batchSize": "<the number of transactions that are being sent in a batch. default to 100 if not specified>",
    "metadata": {
      "imageFile": "<the full path to the media file that contains the NFT image file>",
      "videoFile": "<the full path to the media file that contains the NFT video file>",
      "name": "the value for the name field in the item metadata",
      "description": "the value for the description field in the item metadata"
    }
  }
}
```

Note:

- the _proxiedAddress_ is optional, and if is provided the account that is derived from the _accountSeed_ will act as a proxy account for that address and all the extrinsic calls will be sent as a proxy call on behalf of the _proxiedAddress_.
- The data file specified by `item.data.csvFile` is a csv file, which the number of rows in the file specifies the maximum number of items that will be minted. If specified, the combination of offset and count determines the actual number of items that are going to be minted.
- The offset specifies the first row number in the csv datafile that the items will be minted from that row up to the specified count.
- If the calculated row numbers fall outside of the number of rows in the csv file (e.x. `offset+count-1 > last_row_number_in_the_file`) the minting will stop after the last row number.
- The `item.metadata.imageFile` specifies the file path that contains the media file that is going to be minted.
- The `item.metadata.videoFile` specifies the file path that contains the video file that is going to be minted. Has the same naming format as `item.metadata.imageFile`.
- the values surrounded by `<<` and `>>` will be filled from the columns of the data `.csv` file. e.g. fo the
  path example: `/Users/user/nfts/<<image name>>.png` the `<<image name>>` will be replaced with the value from the "image name" column for each row in the csv datafile.
  Additionally, you can use an empty template: `/Users/user/nfts/<<>>.png` in which the `<<>>` will be replaced with the row numbers for each row.

## Using the CLI

### Running a workflow

To run the workflow you need to execute the cli with `run ` subcommand while passing a workflow configuration as a `.json` file to the command.

```
uniqcamp run <path to workflow.json>
or
npm run uniqcamp -- run <path to workflow.json>
```

There is also an optional parameter available for the dry-run. It will validate the workflow without running the workflow and submitting transactions.

```
uniqcamp run --dry-run <path to workflow.json>
```

After the minting process is complete a final `.csv` data file will be generated at the same path as input datafile (specified by `item.data.csvFile`), This final data file will include the gift secret codes as well some more information.

### Minting to a known address list

For cases when we don't want to generate and pre-fund new accounts, there is an option to mint to a predetermined receivers list.

```
uniqcamp run --with-preset-address <path to workflow.json>
or
npm run uniqcamp -- run --with-preset-address <path to workflow.json>
```

### Setting or changing the item metadata

In some cases, it might be needed to set or change the metadata for the items after the collection items are minted. For those cases, the cli also provides an `update-metadata` subcommand. This subcommand is very similar to the `run` subcommand as it also takes the path to a workflow .json file as argument, but unlike the `run` subcommand that goes through the whole workflow, `update-metadata` only sets the metadata based on the information specified in the workflow, assuming the collection and items are already created.

### burn-reap

This command can be used to burn the unclaimed NFTs and reap the initial funds from unclaimed secrets and transfer the funds back to the original account. The command basically goes through all the gift secrets listed in the `.csv` file that is specified by the `item.data.csvFile` in the workflow, and for each unclaimed secret (secrets that their recipient has not claimed its NFT) it will burn the unclaimed NFTs. It will also transfer all the funds from that gift secret to the original account that is specified by `network.accountSeed`.

## Checkpoints

The workflow is checkpointed at each step, in case it is halted at any point during the process due to any failures, you can take it from where you left and continue it from the last successful checkpoint by running the cli again.

# examples

For sample workflows check the example folder.

- The _simple_ folder includes a csv with no information and mints 10 NFTs with no customized metadata.
- The advanced folder includes a csv with multiple columns and uses the data from csv columns to create customized NFTs, with customized metadata and different images and videos for each NFT.
