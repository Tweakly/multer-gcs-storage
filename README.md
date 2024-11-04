# multer-gcs-storage
A flexible GCS storage backend for multer

[![last commit](https://badgen.net/github/last-commit/Tweakly/multer-gcs-storage)](https://github.com/Twewakly/multer-gcs-storage)
[![npm package link](https://img.shields.io/npm/v/@tweakly/multer-gcs-storage)](https://www.npmjs.com/package/@tweakly/multer-gcs-storage)
[![MIT License](https://badgen.net/npm/license/multer-cloud-storage)](https://opensource.org/licenses/MIT)

## Introduction 
This is a storage engine for [multer](https://github.com/expressjs/multer) that stores files in Google Cloud Storage buckets. 

This package is primarily based on [multer-cloud-storage](https://github.com/alexandre-steinberg/multer-cloud-storage), but with support for multiple buckets and configuration options for local testing.

In addition it has two extension methods compared with the multer interface: downloadFile and deleteFile.

## Getting started
This package can be installed by your favourite package manager, e.g. pnpm.

```bash
pnpm add @tweakly/i18n-node-gcs-backend
```

Wiring up:
```js
import multer from "multer";
import {MulterGcsStorage} from "@tweakly/multer-gcs-storage";

const upload = multer({
    storage: new MulterGcsStorage({
        bucketId: (req, file) => {
            return "file-upload-bucket";
        },
        destination: (req, file, cb) => {
            cb(null, "uploads");
        },
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        }
    }),
});
```

## Extension API

### downloadFile
This method is used to download a file from the bucket. The file will be added as an attachment to the response, and the contents written to the response stream.

```js
 async (bucketName: string, bucketFileName: string,
                  writeFileName: string, res: ExpressResponse): Promise<void>
``` 

### deleteFile
This method is used to delete a file from the bucket.

```js
 async (bucketName: string, bucketFileName: string): Promise<void>
```

## Options
Note: Environment variables have precedence over configured variables where both exists.

| Parameter                   | Description                                     | Environment Variable / .env                   | Options                            |
|-----------------------------|-------------------------------------------------|-----------------------------------------------|------------------------------------|
| Google Project              | Project Name in which the Bucket resides        | `STORAGE_GCP_PROJECT`                         | `googleProject`                    |
| Credentials path (optional) | Provide your own google application credentials | `STORAGE_GOOGLE_APPLICATION_CREDENTIALS_PATH` | `googleApplicationCredentialsPath` |

The credentials used to connect to the GCS bucket needs to have the storage.buckets.get permission. 

All options specific to multer-gcs-storage that can be provided are shown below.


```js
{
  // Can be one of the values defined in Predefined ACLs. Defaults to 'private', but is not set if
  // uniformBucketLevelAccess is enabled.  
  acl: "private",

  // A string or a function that returns a string which represents the bucket id to be used for the given file.    
  // Required
  bucketId: "file-upload-bucket",
  
  // A function that returns the content type to set for the file. Default function returns file.mimetype.      
  contentType: (req, file) => {
    return file.mimetype;
  },      
        
  // A string or a function that gives the destination path for the file. Defaults to empty string     
  destination: (req, file, cb) => {
    cb(null, "uploads");
  },
        
  // A function that returns the filename to be used for the file. Defaults to {uuidv4}_{originalname}.      
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },      
        
  // A boolean that determines if the filename should be hidden in the file object. Defaults to false. If set, 
  // the filename will not be an uuid, and content type undefined.          
  hideFilename: false,      
        
  // If this option is set on the bucket, then it must be set here too. Otherwise an error will
  // be returned from GCS. Defaults to false. See also acl
  uniformBucketLevelAccess: false,      
    
  // The id of the Google project where the bucket is. This can also be set by env variable
  // STORAGE_GCP_PROJECT. It is required in one of the forms.  
  googleProject: "the-project-id",
        
  // The application credentials needed to connect to the GCP Storage bucket. This can also be set by env
  // variable STORAGE_GOOGLE_APPLICATION_CREDENTIALS_PATH.
  // NOTE: When deployed in GCP, credentials will if not provided be picked up from the
  //   cloud execution environment by the underlying client libraries.      
  googleApplicationCredentialsPath: "/somepath/credentials.json",
        
   // The API endpoint to connect to. Primarily useful for local testing, using e.g. fake-gcs-server.      
   // Optional     
   apiEndpoint: "https://storage.googleapis.com"
}
```