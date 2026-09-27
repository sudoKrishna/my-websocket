import net from 'node:net';
import * as crypto from 'node:crypto';

const client = new net.Socket();


client.connect(8080, '127.0.0.1', () => {
    console.log('Connected to server');


    const key = crypto.randomBytes(16).toString('base64');
    const handshake = [
        'GET / HTTP/1.1',
        'Host: 127.0.0.1:8080',
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        '\r\n'
    ].join('\r\n');

    client.write(handshake);
});


client.on('data', (data: Buffer) => {
    const response = data.toString();
    if (response.includes('101 Switching Protocols')) {
        console.log('Handshake completed!');
       
        const message = 'Hello from custom client!';
        const payload = Buffer.from(message, 'utf8');
        const frame = Buffer.alloc(2 + payload.length);
        frame[0] = 0x81;
        frame[1] = payload.length;
        payload.copy(frame, 2);
        client.write(frame);
    } else {
        console.log('Received:', data);
    }
});

client.on('close', () => {
    console.log('Connection closed');
});