import {Request} from "express";
import test from "ava";
import {checkForFile, testSetup, testStorage, testWithStorage} from "./utils/storageutils";

test.before(async () => {
    await testSetup()
});

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
        originalname: "test_testfile7.txt",
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

    const exists = await checkForFile("uploads/test_testfile7.txt");
    t.falsy(exists);
})