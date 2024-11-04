import {Storage} from "@google-cloud/storage";
import MulterGcsStorage, {MulterGcsStorageOptions} from "../../src";
import fs from "fs";
import {Request} from "express";
import urlencode from "urlencode";
import {GenericContainer} from "testcontainers";

export type TestOptions = {
    expectError?: boolean;
    expectContentType?: string;
    contentCheck?: string;
    emptyMimetype?: boolean;
    expectNoOriginalFilename?: boolean;
}

export type MulterTestOptions = Partial<MulterGcsStorageOptions> & TestOptions;

export const checkForFile = async (fileName: string, contentType = "text/plain", contentCheck = "") => {
    const storage = new Storage({ apiEndpoint: process.env.GCS_API_ENDPOINT });
    const bucket = storage.bucket(process.env.BUCKET_NAME as string);
    const file = bucket.file(fileName);
    const exists = await file.exists().catch(() => [false]);
    console.log ("Checking for file: ", fileName, exists);
    if (!exists[0]) {
        return false;
    }

    if (contentType) {
        const [metadata] = await file.getMetadata();
        if (metadata.contentType !== contentType) {
            throw new Error(`Expected content type ${contentType}, but got ${metadata.contentType}`);
        }
    }

    if (contentCheck)  {
        const [content] = await file.download();
        if (content.toString() !== contentCheck) {
            throw new Error(`Expected content ${contentCheck}, but got ${content.toString()}`);
        }
    }

    return true;
};

const defaultOptions = {
    bucketId: "test-bucket"
} as MulterGcsStorageOptions;

export const testWithStorage = async (t: any, multerStorage: MulterGcsStorage, options: TestOptions, testFile: string) => {
    const fileStream = fs.createReadStream(testFile);
    const normalizedFileName = testFile.replace(/\//g, "_");
    const file = {
        originalname: normalizedFileName,
        mimetype: options.emptyMimetype ? "" : "text/plain",
        stream: fileStream
    } as unknown as Express.Multer.File;

    let resultFile: any = null;
    await (async () => {
        return new Promise((resolve, reject) => {
            multerStorage._handleFile({} as unknown as Request, file, (err: any, file: any) => {
                if (err) {
                    if (options.expectError) {
                        resolve("error");
                    }
                    else {
                        reject(err);
                    }
                } else {
                    if (options.expectError) {
                        reject("Expected error, but got none");
                    }
                    else {
                        resolve(file);
                    }
                }
            });
        })
    })().then((createdFile) => {
        resultFile = createdFile;
        t.pass();
    }).catch((err) => {
        t.fail(err);
    });

    if (resultFile && !options.expectError) {
        console.log ("Result file path: ", resultFile.path);
        const exists = await checkForFile(resultFile.path, options.expectContentType, options.contentCheck);
        if (options.expectNoOriginalFilename) {
            t.falsy((resultFile.filename as string).endsWith(normalizedFileName));
        }
        else {
            t.truthy((resultFile.filename as string).endsWith(normalizedFileName));
        }
        t.truthy(exists);
    }
};

export const testStorage = async (t: any, options: MulterTestOptions,
                           testFile = "test/testfile1.txt") => {
    const multerStorage = new MulterGcsStorage({
        apiEndpoint: process.env.GCS_API_ENDPOINT,
        ...defaultOptions,
        ...options
    });

    t.truthy(multerStorage);

    await testWithStorage(t, multerStorage, options, testFile);

    return multerStorage;
};

export const testSetup = async () => {
    process.env.UNITTEST = "true";
    process.env.STORAGE_GCP_PROJECT = "test-project";

    const bucketName = "test-bucket";
    const gcsPort = 4443;
    const gcsContainer = await new GenericContainer("fsouza/fake-gcs-server:1.49.3")
        .withEntrypoint(["/bin/fake-gcs-server", "-scheme", "http"])
        .withExposedPorts(gcsPort)
        .start();

    const apiEndpoint = `http://${gcsContainer.getHost()}:${gcsContainer.getMappedPort(
        gcsPort
    )}`;

    console.log ("apiEndpoint: ", apiEndpoint);

    // Configure the fake GCS server
    await fetch(`${apiEndpoint}/_internal/config`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ externalUrl: apiEndpoint }),
    });

    const storage = new Storage({
        apiEndpoint
    });
    await storage.createBucket(bucketName);

    process.env.GCS_API_ENDPOINT = apiEndpoint;
    process.env.BUCKET_NAME = bucketName;
}
