/* Minimal CDP client: one Runtime.evaluate over a raw WebSocket.
   Usage: node dev/cdp-eval.js "<expr>" [port=9224] */
"use strict";
const http = require("http");
const crypto = require("crypto");
const net = require("net");

const EXPR = process.argv[2] || "1+1";
const PORT = +(process.argv[3] || 9224);

http.get(`http://127.0.0.1:${PORT}/json`, res => {
    let b = "";
    res.on("data", d => b += d);
    res.on("end", () => {
        const page = JSON.parse(b).find(p => p.type === "page");
        if (!page) { console.error("no page target"); process.exit(2); }
        const u = new URL(page.webSocketDebuggerUrl);
        connect(u.hostname, +u.port, u.pathname);
    });
});

function connect(host, port, path) {
    const key = crypto.randomBytes(16).toString("base64");
    const sock = net.connect(port, host, () => {
        sock.write(
            `GET ${path} HTTP/1.1\r\nHost: ${host}:${port}\r\n` +
            `Upgrade: websocket\r\nConnection: Upgrade\r\n` +
            `Sec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let upgraded = false, buf = Buffer.alloc(0);
    sock.on("data", d => {
        buf = Buffer.concat([buf, d]);
        if (!upgraded) {
            const i = buf.indexOf("\r\n\r\n");
            if (i === -1) return;
            buf = buf.slice(i + 4);
            upgraded = true;
            send(sock, JSON.stringify({
                id: 1, method: "Runtime.evaluate",
                params: { expression: EXPR, returnByValue: true },
            }));
        }
        let msg;
        while ((msg = readFrame()) !== null) {
            try {
                const j = JSON.parse(msg);
                if (j.id === 1) {
                    console.log(JSON.stringify(
                        j.result && j.result.result ? j.result.result.value : j, null, 1));
                    sock.destroy(); process.exit(0);
                }
            } catch (e) {}
        }
    });
    function readFrame() {
        if (buf.length < 2) return null;
        let len = buf[1] & 0x7f, off = 2;
        if (len === 126) { if (buf.length < 4) return null; len = buf.readUInt16BE(2); off = 4; }
        else if (len === 127) { if (buf.length < 10) return null; len = Number(buf.readBigUInt64BE(2)); off = 10; }
        if (buf.length < off + len) return null;
        const payload = buf.slice(off, off + len).toString("utf8");
        buf = buf.slice(off + len);
        return payload;
    }
    setTimeout(() => { console.error("timeout"); process.exit(3); }, 8000);
}

function send(sock, text) {
    const p = Buffer.from(text), mask = crypto.randomBytes(4);
    let head;
    if (p.length < 126) head = Buffer.from([0x81, 0x80 | p.length]);
    else { head = Buffer.alloc(4); head[0] = 0x81; head[1] = 0x80 | 126; head.writeUInt16BE(p.length, 2); }
    const masked = Buffer.from(p);
    for (let i = 0; i < masked.length; i++) masked[i] ^= mask[i % 4];
    sock.write(Buffer.concat([head, mask, masked]));
}
