# uniques-campaign-runner

A cli tool to automate running NFT campaign workflows on substrate-uniques-pallet in bulk.  
The tool works in combination with [nft gift app](https://github.com/hamidra/dotdrop/tree/polkadot-nft) to mint NFTs in bulk and creates NFT gift codes which can be claimed using the [nft claim apps](https://claimnft.kusama.network).

## Install

To install the tool, clone this repo:

```bash
# Clone the repository
git clone https://github.com/hamidra/uniques-campaign-runner.git
cd uniques-campaign-runner
```

and install the npm package from the project directory.

```bash
npm install -g .
```

## Define a workflow

To define your workflow you need to provide the cli with a workflow.json based on the following template:

```json
{
  "network": {
    "provider": "<provider e.g. wss://statemine-rpc.polkadot.io>",
    "accountSeed": "<account seed>",
    "proxiedAddress": "<in case the account is a proxy the address of the proxied/primary account>"
  },
  "pinata": {
    "apiKey": "<PinataApiKey>",
    "secretApiKey": "<PinataSecretApiKey>"
  },
  "class": {
    "id": "<classId that the NFT instances are being minted in>",
    "metadata": {
      "imageFile": "<Path to the image file that is used for class metadata>",
      "videoFile": "<Path to the video file that is used for class metadata>",
      "name": "<the value for the name field in class metadata>",
      "description": "the value for the description field in class metadata"
    }
  },
  "instance": {
    "data": {
      "csvFile": "<a csv file that contains the instances data>",
      "offset": "<the row offset, if not specified it starts from row 0>",
      "count": "<the number of rows to be used after offset, if not specified it will count up to the last row.>"
    },
    "initialFund": "<initial starting balance (in chain decimal) for the created gift accounts to be used to pay the tx fees when the NFTs are claimed.
    Make sure it is above the Existential Deposit(ED) of the chain!>",
    "batchSize": "<the number of transactions that are being sent in a batch. default to 100 if not specified>",
    "metadata": {
      "imageFile": "<the full path to the media file that contains the NFT image file>",
      "videoFile": "<the full path to the media file that contains the NFT video file>",
      "name": "the value for the name field in the instance metadata",
      "description": "the value for the description field in the instance metadata"
    }
  }
}
```

Note:

- the _proxiedAddress_ is optional, and if is provided the account that is derived from the _accountSeed_ will be considered a proxy account and all the extrinsic calls will be sent as a proxy call on behalf of the proxiedAddress.
- The data file specified by `instance.data.csvFile` is a csv file, which the number of rows in the file specifies the maximum number of instances that can be minted. If specified, the combination of offset and count determines the actual number of instances that are going to be minted.
- The offset specifies the first row number in the csv datafile that the instances will be minted from that row up to the specified count.
- If the calculated row numbers fall outside of the number of rows in the csv file (e.x. `offset+count-1 > last_row_number_in_the_file`) the minting will stop after the last row number.
- The `instance.metadata.imageFile` specifies the file path that contains the media file that is going to be minted.
  Path example: `/Users/user/nfts/<<image name>>.png` where `<<image name>>` will be replaced with the value in the "image name" column according to the row number in the csv datafile.
  Additionally, you can use this template: `/Users/user/nfts/<>.png` in which the '<>' will be replaced with the row number.
- The `instance.metadata.videoFile` specifies the file path that contains the video file that is going to be minted. Has the same naming format as `instance.metadata.imageFile`.

## Running a workflow

To run the workflow you need to execute the cli while passing a workflow configuration as a .json file to the command.

```
uniqcamp <path to workflow.json>
```

There is an optional parameter available for the dry-run. It will validate the workflow without submitting transactions.

```
uniqcamp <path to workflow.json> --dry-run
```

After the minted process is complete a final .csv data file which includes the gift secret codes will be generated at the same path as input datafile (specified by `instance.data.csvFile`)

## Checkpoints

The workflow is checkpointed at each step, in case it is halted at any point during the process due to any failures, you can take it from where you left and continue it from the last successful checkpoint by running the cli again.

# examples

For sample worflows check the example folder.

- The _simple_ folder includes a csv with no information and mints 10 NFTs with no customized metadata.
- The advanced folder includes a csv with multiple columns and uses the data from csv columns to create customized NFTs, with customized metadata and different images and videos for each NFT.
