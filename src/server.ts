import net from 'node:net';
import * as crypto from 'node:crypto';

const server = net.createServer((socket) => {
    let handshakeCompleted = false;

    socket.on('data', (data: Buffer) => {
        // --------------------------------------------------
        // 1. HTTP WebSocket handshake
        // --------------------------------------------------

        if (!handshakeCompleted) {
            const request = data.toString('utf8');

            console.log('Received request:\n', request);

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

            // Get Sec-WebSocket-Key
            const keyMatch = request.match(
                /Sec-WebSocket-Key:\s*(.+)\r?\n/i
            );

            if (!keyMatch) {
                socket.end(
                    'HTTP/1.1 400 Bad Request\r\n\r\n'
                );

                return;
            }

            const key = keyMatch[1]?.trim();

            if (!key) {
                socket.end(
                    'HTTP/1.1 400 Bad Request\r\n\r\n'
                );

                return;
            }

            // --------------------------------------------------
            // Create Sec-WebSocket-Accept
            // --------------------------------------------------

            const magicString =
                '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

            const sha1Hash = crypto
                .createHash('sha1')
                .update(key + magicString)
                .digest();

            const acceptKey = sha1Hash.toString('base64');

            // --------------------------------------------------
            // Send 101 Switching Protocols
            // --------------------------------------------------

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

            /*
             * IMPORTANT:
             *
             * This data contains the HTTP handshake.
             * Do NOT try to parse it as a WebSocket frame.
             *
             * The browser will send the WebSocket frame
             * in a subsequent "data" event.
             */

            return;
        }

        // --------------------------------------------------
        // 2. WebSocket frame
        // --------------------------------------------------

        if (data.length < 2) {
            console.error('Incomplete WebSocket frame');
            return;
        }

        // First 2 bytes of a WebSocket frame
        const firstByte = data.readUInt8(0);
        const secondByte = data.readUInt8(1);

        // FIN bit
        const fin = (firstByte & 0x80) !== 0;

        // Opcode
        const opcode = firstByte & 0x0F;

        // MASK bit
        const mask = (secondByte & 0x80) !== 0;

        // Payload length
        let payloadLength = secondByte & 0x7F;

        // Current position in the frame
        let offset = 2;

        console.log('--- WebSocket Frame ---');
        console.log('FIN:', fin);
        console.log('Opcode:', `0x${opcode.toString(16)}`);
        console.log('Masked:', mask);
        console.log('Initial payload length:', payloadLength);

        // --------------------------------------------------
        // 3. Extended payload length
        // --------------------------------------------------

        if (payloadLength === 126) {
            if (data.length < 4) {
                console.error('Incomplete extended payload length');
                return;
            }

            payloadLength = data.readUInt16BE(2);

            offset = 4;
        } else if (payloadLength === 127) {
            if (data.length < 10) {
                console.error('Incomplete 64-bit payload length');
                return;
            }

            const length64 = data.readBigUInt64BE(2);

            /*
             * JavaScript numbers can safely represent integers
             * only up to Number.MAX_SAFE_INTEGER.
             */

            if (length64 > BigInt(Number.MAX_SAFE_INTEGER)) {
                console.error('Payload is too large');
                socket.end();
                return;
            }

            payloadLength = Number(length64);

            offset = 10;
        }

        // --------------------------------------------------
        // 4. Read masking key
        // --------------------------------------------------

        let maskKey: Buffer | null = null;

        if (mask) {
            if (data.length < offset + 4) {
                console.error('Incomplete masking key');
                return;
            }

            maskKey = data.subarray(offset, offset + 4);

            offset += 4;
        }

        // --------------------------------------------------
        // 5. Make sure complete payload exists
        // --------------------------------------------------

        if (data.length < offset + payloadLength) {
            console.error('Incomplete frame received');
            return;
        }

        // --------------------------------------------------
        // 6. Extract payload
        // --------------------------------------------------

        const payload = data.subarray(
            offset,
            offset + payloadLength
        );

        // --------------------------------------------------
        // 7. Unmask payload
        // --------------------------------------------------

        if (mask && maskKey) {
            for (let i = 0; i < payload.length; i++) {
                payload[i]! ^= maskKey[i % 4]!;
            }
        }

        // --------------------------------------------------
        // 8. Handle WebSocket opcode
        // --------------------------------------------------

        if (opcode === 0x1) {
            // Text frame

            const message = payload.toString('utf8');

            console.log(
                'Received text message:',
                message
            );

            // Send the same message back
            sendText(socket, message);

        } else if (opcode === 0x2) {
            // Binary frame

            console.log(
                'Received binary data:',
                payload
            );

        } else if (opcode === 0x8) {
            // Close frame

            console.log('Received close frame');

            // WebSocket close frame
            const closeFrame = Buffer.from([
                0x88,
                0x00
            ]);

            socket.write(closeFrame);
            socket.end();

        } else if (opcode === 0x9) {
            // Ping

            console.log('Received ping');

            // Pong
            const pongFrame = Buffer.from([
                0x8A,
                0x00
            ]);

            socket.write(pongFrame);

        } else if (opcode === 0xA) {
            // Pong

            console.log('Received pong');

        } else {
            console.log(
                'Unknown opcode:',
                `0x${opcode.toString(16)}`
            );
        }
    });

    socket.on('error', (err) => {
        console.error('Socket error:', err);
    });

    socket.on('close', () => {
        console.log('Socket closed');
    });
});

// --------------------------------------------------
// Send a WebSocket text frame
// --------------------------------------------------

function sendText(socket: net.Socket, message: string) {
    const payload = Buffer.from(message, 'utf8');

    let frame: Buffer;

    if (payload.length < 126) {
        frame = Buffer.alloc(2 + payload.length);

        frame[0] = 0x81;
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

        frame.writeBigUInt64BE(
            BigInt(payload.length),
            2
        );

        payload.copy(frame, 10);
    }

    socket.write(frame);
}

// --------------------------------------------------
// Start server
// --------------------------------------------------

server.listen(8080, '127.0.0.1', () => {
    console.log(
        'Server running on ws://127.0.0.1:8080'
    );
});