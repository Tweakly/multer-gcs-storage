import test from "ava";
import {checkForFile, testSetup, testStorage} from "./utils/storageutils";
import MulterGcsStorage from "../src";
import httpMocks from "node-mocks-http";

test.before(async () => {
    await testSetup()
});

test("GCS integration, deleteFile", async t => {
    const multerStorage = await testStorage(t, {
            destination: "deleteables",
            filename: (req, file, cb) => {
                cb(null, file.originalname);
            },
        },
        "test/testfile8.txt");

    const exists = await checkForFile("deleteables/" + "test_testfile8.txt");
    t.truthy(exists);

    await multerStorage.deleteFile(process.env.BUCKET_NAME as string, "deleteables/test_testfile8.txt");

    const notExists = await checkForFile("deleteables/" + "test_testfile8.txt");
    t.falsy(notExists);
    t.pass();
});

test("GCS integration, deleteFile error handling", async t => {
    const multerStorage = new MulterGcsStorage({
        apiEndpoint: process.env.GCS_API_ENDPOINT,
        bucketId: "test-bucket"
    });

    t.truthy(multerStorage);

    await t.notThrowsAsync(multerStorage.deleteFile(process.env.BUCKET_NAME as string,
        "deleteables/" + "test_testfile-non-exist.txt"));

    t.pass();
});
