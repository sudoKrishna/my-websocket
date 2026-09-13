import net from "node:net";
import crypto from "node:crypto";



const server = net.createServer((socket) => {
  console.log("Client connected");

socket.on("data", (data) => {
  const request = data.toString();

  const lines = request.split("\r\n");

  const requestLine = lines[0];

  console.log("Request line:", requestLine);

  const [method, path, version] = requestLine.split(" ");

  console.log("Method:", method);
  console.log("Path:", path);
  console.log("Version:", version);

  const headers : Record<string, string> = {};


  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];

    if (line === "") {
      break;
    }

    const [name, ...valueParts] = line.split(":");

    const value = valueParts.join(":").trim();

    headers[name.toLowerCase()] = value;
    console.log("Header:", name, "=", value);
  }
 
  const isWebSocket =
  method === "GET" &&
  version === "HTTP/1.1" &&
  headers["upgrade"]?.toLowerCase() === "websocket" &&
  headers["connection"]?.toLowerCase().includes("upgrade") &&
  headers["sec-websocket-key"] !== undefined &&
  headers["sec-websocket-version"] === "13";

console.log("Is WebSocket:", isWebSocket);

if(isWebSocket) {
  const key = headers["sec-websocket-key"]

  const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
  
  console.log("Sec-Websocket-Accept:", accept)

   const response =
    "HTTP/1.1 101 Switching Protocols\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    `Sec-WebSocket-Accept: ${accept}\r\n` +
    "\r\n";

  socket.write(response);
}
});

  socket.on("close", () => {
    console.log("Client disconnected");
  });
});

server.listen(8080, () => {
  console.log("TCP server listening on port 8080");
});