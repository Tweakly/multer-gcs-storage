import test from "ava";
import httpMocks from "node-mocks-http";
import {checkForFile, testSetup, testStorage} from "./utils/storageutils";
import urlencode from "urlencode";
import MulterGcsStorage from "../src";

test.before(async () => {
    await testSetup()
});

test("GCS integration, downloadFile", async t => {
    const multerStorage = await testStorage(t, {
            destination: "downloadables",
            filename: (req, file, cb) => {
                cb(null, file.originalname);
            },
        },
        "test/testfile8.txt");

    const exists = await checkForFile("downloadables/" + "test_testfile8.txt");
    t.truthy(exists);

    const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter
    });
    res.on("error", () => {
        t.fail("Error event should not be triggered");
    });
    res.on("end", () => {
        // @ts-ignore
        t.is(res._getChunks().toString(), "testfile8");
    });

    await multerStorage.downloadFile(process.env.BUCKET_NAME as string,
        "downloadables/" + "test_testfile8.txt",
        "testfile3.txt", res);

    // @ts-ignore
    t.deepEqual(res._getChunks().toString(), "testfile8");
    t.pass();
});

test("GCS integration, downloadFile error handling", async t => {
    const multerStorage = new MulterGcsStorage({
        apiEndpoint: process.env.GCS_API_ENDPOINT,
        bucketId: "test-bucket"
    });

    t.truthy(multerStorage);
    const res = httpMocks.createResponse({
        eventEmitter: require('events').EventEmitter
    });
    res.on("error", (err) => {
        t.fail("Error event should not be triggered");
    });

    await t.throwsAsync(multerStorage.downloadFile(process.env.BUCKET_NAME as string,
            "downloadables/" + "test_testfile-non-exist.txt",
            "testfile3.txt", res), { message: /does not exist in bucket/ });

    t.pass();
});