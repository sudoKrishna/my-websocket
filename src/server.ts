import net from 'node:net';
import * as crypto from 'node:crypto';

 const clients = new Set<net.Socket>();

const server = net.createServer((socket) => {
    let handshakeCompleted = false;
    let accumulatedData = Buffer.alloc(0);
   

    // Add the socket to the clients set immediately
    clients.add(socket);
    console.log(`New connection from ${socket.remoteAddress}`);

    socket.on('data', (data: Buffer) => {
        accumulatedData = Buffer.concat([accumulatedData, data]);

        // --------------------------------------------------
        // 1. HTTP WebSocket handshake
        // --------------------------------------------------
        if (!handshakeCompleted) {
            const request = accumulatedData.toString('utf8');
            console.log('Received request:\n', request);

            // Extract token from the request URL
            const tokenMatch = request.match(/token=([^&\s]+)/i);
            const token = tokenMatch ? tokenMatch[1] : null;

            const VALID_TOKEN = 'abc123';
            if (!token || token !== VALID_TOKEN) {
                socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n');
                return;
            }

            const requestLower = request.toLowerCase();
            const isWebSocketRequest =
                requestLower.includes('upgrade: websocket') &&
                requestLower.includes('connection: upgrade');

            if (!isWebSocketRequest) {
                socket.end(
                    'HTTP/1.1 400 Bad Request\r\n' +
                    'Content-Type: text/plain\r\n' +
                    'Content-Length: 24\r\n' +
                    '\r\n' +
                    'Not a WebSocket request.'
                );
                return;
            }

            // Extract Sec-WebSocket-Key
            const keyMatch = request.match(/Sec-WebSocket-Key:\s*(.+)\r?\n/i);
            if (!keyMatch) {
                socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
                return;
            }

            const key = keyMatch[1]?.trim();
            if (!key) {
                socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
                return;
            }

            // Compute Sec-WebSocket-Accept
            const magicString = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
            const sha1Hash = crypto.createHash('sha1').update(key + magicString).digest();
            const acceptKey = sha1Hash.toString('base64');

            // Send 101 Switching Protocols
            const response = [
                'HTTP/1.1 101 Switching Protocols',
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Accept: ${acceptKey}`,
                '',
                ''
            ].join('\r\n');

            socket.write(response);
            handshakeCompleted = true;
            console.log('WebSocket handshake completed!');

            // Clear accumulatedData after handshake
            accumulatedData = Buffer.alloc(0);
            return;
        }

        // --------------------------------------------------
        // 2. WebSocket frame parsing (after handshake)
        // --------------------------------------------------
        while (accumulatedData.length > 0) {
            if (accumulatedData.length < 2) {
                console.error('Incomplete WebSocket frame');
                break;
            }

            const firstByte = accumulatedData.readUInt8(0);
            const secondByte = accumulatedData.readUInt8(1);

            const fin = (firstByte & 0x80) !== 0;
            const opcode = firstByte & 0x0F;
            const mask = (secondByte & 0x80) !== 0;
            let payloadLength = secondByte & 0x7F;
            let offset = 2;

            // Handle extended payload length
            if (payloadLength === 126) {
                if (accumulatedData.length < 4) break;
                payloadLength = accumulatedData.readUInt16BE(2);
                offset = 4;
            } else if (payloadLength === 127) {
                if (accumulatedData.length < 10) break;
                const length64 = accumulatedData.readBigUInt64BE(2);
                if (length64 > BigInt(Number.MAX_SAFE_INTEGER)) {
                    console.error('Payload is too large');
                    socket.end();
                    return;
                }
                payloadLength = Number(length64);
                offset = 10;
            }

            // Extract masking key if masked
            let maskKey: Buffer | null = null;
            if (mask) {
                if (accumulatedData.length < offset + 4) break;
                maskKey = accumulatedData.subarray(offset, offset + 4);
                offset += 4;
            }

            // Ensure complete payload exists
            if (accumulatedData.length < offset + payloadLength) break;

            // Extract payload
            const payload = accumulatedData.subarray(offset, offset + payloadLength);

            // Unmask payload if masked
            if (mask && maskKey) {
                for (let i = 0; i < payload.length; i++) {
                    payload[i]! ^= maskKey[i % 4]!;
                }
            }

            // Handle WebSocket opcode
            if (opcode === 0x1) {
                // Text frame
                const message = payload.toString('utf8');
                console.log('Received text message:', message);

                // Broadcast to all clients except the sender
                clients.forEach((client) => {
                    if (client !== socket) {
                        sendText(client, `Broadcast: ${message}`);
                    }
                });

                // Echo back to the sender (optional)
                sendText(socket, message);
            } else if (opcode === 0x8) {
                // Close frame
                console.log('Received close frame');
                const closeFrame = Buffer.from([0x88, 0x00]);
                socket.write(closeFrame);
                socket.end();
            } else if (opcode === 0x2) {
                // Binary frame
                console.log('Received binary data:', payload);
            } else if (opcode === 0x9) {
                // Ping
                console.log('Received ping');
                const pongFrame = Buffer.from([0x8A, 0x00]);
                socket.write(pongFrame);
            } else if (opcode === 0xA) {
                // Pong
                console.log('Received pong');
            } else {
                console.log('Unknown opcode:', `0x${opcode.toString(16)}`);
            }

            // Remove the parsed frame from accumulatedData
            accumulatedData = accumulatedData.subarray(offset + payloadLength);
        }
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });

    socket.on('close', () => {
        console.log(`Connection closed from ${socket.remoteAddress}`);
        clients.delete(socket); // Remove the socket from the clients set
    });
});

// Send a WebSocket text frame
function sendText(socket: net.Socket, message: string) {
    const payload = Buffer.from(message, 'utf8');
    let frame: Buffer;

    if (payload.length < 126) {
        frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x81; // FIN=1, Opcode=0x1 (text frame)
        frame[1] = payload.length;
        payload.copy(frame, 2);
    } else if (payload.length < 65536) {
        frame = Buffer.alloc(4 + payload.length);
        frame[0] = 0x81;
        frame[1] = 126;
        frame.writeUInt16BE(payload.length, 2);
        payload.copy(frame, 4);
    } else {
        frame = Buffer.alloc(10 + payload.length);
        frame[0] = 0x81;
        frame[1] = 127;
        frame.writeBigUInt64BE(BigInt(payload.length), 2);
        payload.copy(frame, 10);
    }

    socket.write(frame);
}

// Start server
server.listen(8080, '127.0.0.1', () => {
    console.log('Server running on ws://127.0.0.1:8080');
});