import net from "node:net";

const server = net.createServer((socket) => {
  console.log("Client connected");

  socket.on("data", (data) => {
    console.log("Received:", data.toString());
    console.log("received: ", data);
    console.log("received" , [...data])
  });

  socket.on("close", () => {
    console.log("Client disconnected");
  });
});

server.listen(8080, () => {
  console.log("TCP server listening on port 8080");
});
