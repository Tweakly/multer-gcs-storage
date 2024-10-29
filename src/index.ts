/* c8 ignore next */
import multer from "multer";
import * as Storage from "@google-cloud/storage";
import {Request, Response as ExpressResponse} from "express";
import {v4 as uuid} from "uuid";

import {buildConfiguration, GCPOptions, getGCSBucket, getGCSStorageClient, verifyConfiguration} from "./gcp-specific";
import {PredefinedAcl} from "@google-cloud/storage";
import urlencode from "urlencode";

export type ContentTypeFunction = (req: Request, file: Express.Multer.File) => string | undefined;
export type BucketIdFunction = (req: Request, file: Express.Multer.File) => string | Promise<string>;
export type MulterHandler<T> = (req: Request, file: Express.Multer.File, cb: T) => void;
export type FileNameCallback = (err: any, fileName: string) => void;
export type DestinationCallback = (err: any, destination: string) => void;
export type FileNameFunction = MulterHandler<FileNameCallback>;
export type DestinationFunction = MulterHandler<DestinationCallback>;

type BucketFileReference = {
    bucket: Storage.Bucket,
    destination: string,
    filename: string
}

export type MulterGcsStorageOptions = {
    acl?: PredefinedAcl,
    bucketId: BucketIdFunction | string,
    contentType?: ContentTypeFunction,
    destination?: DestinationFunction | string,
    filename?: FileNameFunction,
    hideFilename?: boolean,
    uniformBucketLevelAccess?: boolean,
} & Partial<GCPOptions>;

export type MulterGcsStorageFileInfo = Partial<Express.Multer.File> & {
    bucket: string,
    contentType?: string,
    uri: string,
    path: string,
    linkUrl: string,
    selfLink?: string,
};

export default class MulterGcsStorage implements multer.StorageEngine {

    private gcsStorage: Storage.Storage | undefined;
    private buckets = new Map<string, Storage.Bucket>();
    private options: MulterGcsStorageOptions;
    private readonly verifiedConfiguration: GCPOptions;

    private getBucketFileReference = async (req: Request, file: Express.Multer.File): Promise<BucketFileReference> => {
        if (!this.gcsStorage) {
            this.gcsStorage = await getGCSStorageClient(this.verifiedConfiguration);
        }

        const bucketId = typeof this.options.bucketId === "string" ?
            this.options.bucketId :
            await this.options.bucketId(req, file);

        const bucketFile: Partial<BucketFileReference> = {};

        if (!this.buckets.has(bucketId)) {
            try {
                const bucket = await getGCSBucket(this.gcsStorage, bucketId);
                this.buckets.set(bucketId, bucket);
                bucketFile.bucket = bucket;
            }
            catch (e) {
                // FUTURE: Maybe have option to create bucket here
                throw new Error(`Bucket ${bucketId} does not exist`);
            }
        }
        else {
            bucketFile.bucket = this.buckets.get(bucketId)!;
        }

        this.getDestination(req, file, (err, destination) => {
            if (err) {
                throw err;
            }
            let escDestination = "";
			escDestination += destination
				.replace(/^\.+/g, "")
				.replace(/^\/+|\/+$/g, "");

			if (escDestination !== "") {
				escDestination = escDestination + "/";
			}

            bucketFile.destination = escDestination;
        });

        this.getFilename(req, file, (err, filename) => {
            if (err) {
                throw err;
            }
            bucketFile.filename = urlencode(filename
                .replace(/^\.+/g, "")
                .replace(/^\/+/g, "")
                .replace(/[\r\n]/g, "-")
            );
        });

        return bucketFile as BucketFileReference;
    }

    private readonly getDestination: DestinationFunction = (req, file, cb) => {
        cb (null, "");
    }

    private readonly getContentType: ContentTypeFunction = (req, file) => {
        return (file && file.mimetype) ? file.mimetype : undefined;
    }

    private readonly getFilename: FileNameFunction = (req, file, cb) => {
    	cb(null,`${uuid()}_${file.originalname}`);
	}

    private readonly defaultOptions: Partial<MulterGcsStorageOptions> = {
        acl: "private",
        destination: this.getDestination,
        contentType: this.getContentType,
        filename: this.getFilename
    };

    constructor(opts: MulterGcsStorageOptions) {
        this.options = {
            ...this.defaultOptions,
            ...opts
        };

        if (opts.hideFilename) {
            this.getFilename = (req, file, cb) => cb(null, `${uuid()}`);
            this.getContentType = (req, file) => undefined;
        }
        else {
            if (opts.destination) {
                typeof opts.destination === "string"
                    ? this.getDestination = (req, file, cb) => cb(null, opts.destination as string)
                    : this.getDestination = opts.destination as DestinationFunction;
            }

            if (opts.filename) {
                this.getFilename = opts.filename as FileNameFunction;
            }
        }

        if (opts.contentType) {
            this.getContentType = opts.contentType as ContentTypeFunction;
        }

        this.verifiedConfiguration = verifyConfiguration(buildConfiguration(opts));
    }

    _handleFile(req: Request, file: Express.Multer.File, cb: (error?: any, info?: MulterGcsStorageFileInfo) => void): void {
        this.getBucketFileReference(req, file)
            .then(({bucket, destination, filename}) => {
                const blob = bucket.file(`${destination}${filename}`);

                const streamOpts: Storage.CreateWriteStreamOptions = {
                    // NOTE: Setting this to false if unittesting, due to this bug in fake-gcs-server:
                    // https://github.com/fsouza/fake-gcs-server/issues/1098
                    /* c8 ignore next */
                    resumable: (file.size > 10_000_000 && !process.env.UNITTEST)
                };

                if (!this.options.uniformBucketLevelAccess) {
                    streamOpts.predefinedAcl = this.options.acl
                }

                const contentType = this.getContentType(req, file);
                if (contentType) {
                    streamOpts.metadata = {contentType};
                }

                file.stream.pipe(blob.createWriteStream(streamOpts))
                    .on("error", (err) => cb(err))
                    .on("finish", () => {
                        const name = blob.metadata.name;
                        const filename = name?.substring(name.lastIndexOf("/") + 1);
                        cb(null, {
                            bucket: blob.metadata.bucket,
                            destination,
                            filename,
                            path: `${destination}${filename}`,
                            contentType: blob.metadata.contentType,
                            mimetype: blob.metadata.contentType,
                            /* c8 ignore next */
                            size: typeof blob.metadata.size === "string" ? parseInt(blob.metadata.size) : blob.metadata.size,
                            uri: `gs://${blob.metadata.bucket}/${destination}${filename}`,
                            linkUrl: `${this.gcsStorage!.apiEndpoint}/${blob.metadata.bucket}/${destination}${filename}`,
                            selfLink: blob.metadata.selfLink,
                        } as MulterGcsStorageFileInfo);
                    });
            })
            .catch(cb);
    }

    _removeFile(req: Request, file: Express.Multer.File, callback: (error: (Error | null)) => void): void {
        this.getBucketFileReference(req, file).then(({bucket, destination, filename}) => {
            const blob = bucket.file(`${destination}${filename}`);
            blob.delete().then(() => callback(null)).catch(callback);
        });
    }

    downloadFile = async (bucketName: string, bucketFileName: string,
                  writeFileName: string, res: ExpressResponse): Promise<void> => {
        try {
            if (!this.gcsStorage) {
                this.gcsStorage = await getGCSStorageClient(this.verifiedConfiguration);
            }

            const bucket = this.gcsStorage.bucket(bucketName);
            const file = bucket.file(bucketFileName);
            res.attachment(writeFileName);

            return new Promise((resolve, reject) => {
                file.createReadStream()
                    .pipe(res)
                    .on("error", (err) => { reject(err); })
                    .on("finish", () => {
                        resolve();
                    });
            });
        }
        catch (e) {
            return Promise.reject(e);
        }
    };

    deleteFile = async (bucketName: string, bucketFileName: string) => {
        try {
            if (!this.gcsStorage) {
                this.gcsStorage = await getGCSStorageClient(this.verifiedConfiguration);
            }

            const bucket = this.gcsStorage.bucket(bucketName);
            const file = bucket.file(bucketFileName);

            await file.delete();
            return Promise.resolve();
        }
        catch (e) {
            return Promise.reject(e);
        }
    };
}