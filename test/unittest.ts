import {GenericContainer} from "testcontainers";
import {Storage} from "@google-cloud/storage";
import {Request} from "express";
import fs from "fs";
import test from "ava";

import MulterGcsStorage, {MulterGcsStorageOptions} from "../src";
import urlencode from "urlencode";

type TestOptions = {
    expectError?: boolean;
    expectContentType?: string;
    contentCheck?: string;
    emptyMimetype?: boolean;
    expectNoOriginalFilename?: boolean;
}

type MulterTestOptions = Partial<MulterGcsStorageOptions> & TestOptions;

test.before(async () => {
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

    // Configure the fake GCS server
    await fetch(`${apiEndpoint}/_internal/config`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ externalUrl: apiEndpoint }),
    });

    const storage = new Storage({ apiEndpoint });
    await storage.createBucket(bucketName);

    process.env.GCS_API_ENDPOINT = apiEndpoint;
    process.env.BUCKET_NAME = bucketName;
});

const checkForFile = async (fileName: string, contentType = "text/plain", contentCheck = "") => {
    const storage = new Storage({ apiEndpoint: process.env.GCS_API_ENDPOINT });
    const bucket = storage.bucket(process.env.BUCKET_NAME as string);
    const file = bucket.file(fileName);
    const exists = await file.exists().catch(() => [false]);
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

const testWithStorage = async (t: any, multerStorage: MulterGcsStorage, options: TestOptions, testFile: string) => {
    const fileStream = fs.createReadStream(testFile);
    const file = {
        originalname: testFile,
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
        const exists = await checkForFile(resultFile.path, options.expectContentType, options.contentCheck);
        if (options.expectNoOriginalFilename) {
            t.falsy((resultFile.filename as string).endsWith(urlencode(testFile)));
        }
        else {
            t.truthy((resultFile.filename as string).endsWith(urlencode(testFile)));
        }
        t.truthy(exists);
    }
};

const testStorage = async (t: any, options: MulterTestOptions,
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

test("GCS integration, string bucketId, filename function", async t => {
    const multerStorage = await testStorage(t, {
        destination: "uploads",
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        }
    });

    // And another to test bucket reuse
    await testWithStorage(t, multerStorage, {}, "README.md");
});

test("GCS integration, bucketId as function", async t => {
    await testStorage(t, {
        bucketId: async (req, file) => {
            return "test-bucket";
        },
        contentCheck: "testfile3",
    },
    "test/testfile3.txt");
});

test("GCS integration, bucket doesn't exists", async t => {
    await testStorage(t, {
        bucketId: "non-existing-bucket",
        expectError: true
    },
    "test/testfile4.txt");
});

test("GCS integration, error from destination function", async t => {
    await testStorage(t, {
        destination: (req, file, cb) => {
            cb(new Error("Error from destination function"), "");
        },
        expectError: true
    },
    "test/testfile5.txt");
});

test("GCS integration, error from filename function", async t => {
    await testStorage(t, {
        filename: (req, file, cb) => {
            cb(new Error("Error from filename function"), "");
        },
        expectError: true,
    },
    "test/testfile6.txt");
});

test("GCS integration, content type function", async t => {
    await testStorage(t, {
        destination: "uploads",
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        },
        contentType: (req, file) => {
            return "text/foo";
        },
        expectContentType: "text/foo"
    },
    "test/testfile2");

    await testStorage(t, {
        destination: "uploads",
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        },
        emptyMimetype: true,
        // Default content type when nothing is set
        expectContentType: "application/octet-stream"
    },
    "test/testfile2");
});

test("GCS integration, hideFilename", async t => {
    await testStorage(t, {
        destination: "uploads",
        hideFilename: true,
        // Default content type when nothing is set
        contentCheck: "testfile4",
        expectContentType: "application/octet-stream",
        expectNoOriginalFilename: true
    }, "test/testfile4.txt");
});

test("GCS integration, _removeFile", async t => {
    const multerStorage = await testStorage(t, {
        destination: "uploads",
        filename: (req, file, cb) => {
            cb(null, file.originalname);
        },
    },
    "test/testfile7.txt");

    const file = {
        originalname: "test/testfile7.txt",
    };

    await (async () => {
        return new Promise((resolve, reject) => {
            multerStorage._removeFile({} as unknown as Request, file as Express.Multer.File, (err: any) => {
                if (err) {
                    reject(err);
                } else {
                    resolve("success");
                }
            });
        })
    })().then(() => {
        t.pass();
    }).catch((err) => {
        t.fail(err);
    });

    const exists = await checkForFile("uploads/test/testfile7.txt");
    t.falsy(exists);
})