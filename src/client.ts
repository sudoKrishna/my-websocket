import net from "node:net";

const socket = net.createConnection({
  host: "localhost",
  port: 8080,
});

socket.on("connect", () => {
  console.log("Connected");

  socket.write(
    "GET / HTTP/1.1\r\n" +
    "Host: localhost:8080\r\n" +
    "Upgrade: websocket\r\n" +
    "Connection: Upgrade\r\n" +
    "Sec-WebSocket-Key: SGVsbG9XZWJTb2NrZXQ=\r\n" +
    "Sec-WebSocket-Version: 13\r\n" +
    "\r\n"
  );
});

socket.on("data", (data) => {
  console.log("server sent:", data.toString());
});

socket.on("close", () => {
  console.log("connection closed");
});