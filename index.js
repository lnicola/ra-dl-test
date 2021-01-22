import fetch from "node-fetch";
import * as stream from "stream";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as util from "util";
import * as zlib from "zlib";

const pipeline = util.promisify(stream.pipeline);

export async function download() {
    const dest = "rust-analyzer-linux";
    const randomHex = crypto.randomBytes(5).toString("hex");
    const tempFile = path.join(".", `rust-analyzer-linux${randomHex}`);
    await fs.promises.unlink(dest).catch(err => {
        if (err.code !== "ENOENT")
            throw err;
    });
    let lastPercentage = 0;
    const url = "https://github.com/rust-analyzer/rust-analyzer/releases/download/2021-01-18/rust-analyzer-x86_64-pc-windows-msvc.gz";
    await downloadFile(url, tempFile, 0o755, true, (readBytes, totalBytes) => {
        const newPercentage = ((readBytes / totalBytes) * 100).toFixed(0);
        if (newPercentage != lastPercentage) {
            console.log(newPercentage + "%");
            lastPercentage = newPercentage;
        }
    });
    await fs.promises.rename(tempFile, dest);
}

async function downloadFile(url, destFilePath, mode, gunzip, onProgress) {
    const res = await fetch(url);
    if (!res.ok) {
        console.log(await res.text);
        throw new Error(`Got response ${res.status} when trying to download a file.`);
    }
    const totalBytes = Number(res.headers.get('content-length'));
    let readBytes = 0;
    res.body.on("data", (chunk) => {
        readBytes += chunk.length;
        onProgress(readBytes, totalBytes);
    });
    const destFileStream = fs.createWriteStream(destFilePath, { mode });
    const srcStream = gunzip ? res.body.pipe(zlib.createGunzip()) : res.body;
    await pipeline(srcStream, destFileStream);
    // Don't apply the workaround in fixed versions of nodejs, since the process
    // freezes on them, the process waits for no-longer emitted `close` event.
    // The fix was applied in commit 7eed9d6bcc in v13.11.0
    // See the nodejs changelog:
    // https://github.com/nodejs/node/blob/master/doc/changelogs/CHANGELOG_V13.md
    const [, major, minor] = /v(\d+)\.(\d+)\.(\d+)/.exec(process.version);
    if (+major > 13 || (+major === 13 && +minor >= 11))
        return;
    await new Promise(resolve => {
        destFileStream.on("close", resolve);
        destFileStream.destroy();
        // This workaround is awaiting to be removed when vscode moves to newer nodejs version:
        // https://github.com/rust-analyzer/rust-analyzer/issues/3167
    });
}

download().then(() => console.log("done")).catch(e => console.log(e));
